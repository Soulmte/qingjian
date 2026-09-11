//! Silent PDF export.
//!
//! A PDF with correct Chinese text needs an embedded CJK font subset, which means
//! parsing and rebuilding TrueType tables — hundreds of lines of glyph-table
//! surgery, and nothing here to verify the result with. The webview already has a
//! complete print pipeline, so that is what this uses instead: the document is
//! rendered into an off-screen window and handed to WebView2's `PrintToPdf`, which
//! writes the file itself.
//!
//! The difference from the browser print dialog is the point: no dialog to click
//! through, and no header, footer or page number in the margin. The page box and
//! margins come from the same export settings the HTML output uses, and the CSS
//! carries the inset (see `render_html`), so the file, a browser print and this
//! path all agree on the layout.

use std::path::{Path, PathBuf};
use std::sync::{Arc, Mutex};
use std::time::Duration;

#[cfg(windows)]
use std::os::windows::ffi::OsStrExt;

use tauri::{AppHandle, WebviewUrl, WebviewWindow, WebviewWindowBuilder};
use tokio::sync::mpsc::{unbounded_channel, UnboundedSender};

use super::export::{render_html, Block, ExportStyles};
use crate::error::{AppError, AppResult};

#[cfg(windows)]
use webview2_com::{
    Microsoft::Web::WebView2::Win32::{
        ICoreWebView2_7, ICoreWebView2Environment6, ICoreWebView2PrintSettings,
    },
    PrintToPdfCompletedHandler,
};
#[cfg(windows)]
use windows_core::{Interface, PCWSTR};

/// How long a document may take to load and print before the command gives up.
const TIMEOUT: Duration = Duration::from_secs(90);

/// The answer a print job sends back to the awaiting command.
type Done = UnboundedSender<Result<(), String>>;

const MM_PER_INCH: f64 = 25.4;

/// The page box, in the inches the print settings are expressed in.
///
/// The margins are deliberately not here: the rendered page carries its own
/// inset as body padding, so the print settings ask for none.
#[derive(Clone, Copy, Debug)]
pub struct PdfPage {
    pub width: f64,
    pub height: f64,
}

impl PdfPage {
    /// Builds the box from the millimetres the settings dialog works in.
    pub fn from_mm(page_w: f32, page_h: f32) -> Self {
        let inches = |value: f32| f64::from(value) / MM_PER_INCH;
        Self {
            width: inches(page_w),
            height: inches(page_h),
        }
    }
}

/// Renders a document straight to a PDF file, with nothing to confirm.
pub async fn write(
    app: &AppHandle,
    target: &Path,
    blocks: &[Block],
    styles: &ExportStyles,
) -> AppResult<String> {
    let (page_w, page_h) = styles.page_mm();
    let page = PdfPage::from_mm(page_w, page_h);

    // The page is written to a real file rather than a data URL: WebView2 needs a
    // document it can load, and `file://` is the scheme available here without
    // enabling another feature.
    let source = std::env::temp_dir().join(format!("qingjian-export-{}.html", std::process::id()));
    std::fs::write(&source, render_html(blocks, styles))?;

    let result = render_pdf(app, &source, target, page).await;
    // The temp file has no further use, and leaving it behind would litter the
    // folder the user's system keeps for exactly this.
    let _ = std::fs::remove_file(&source);

    result?;
    Ok(target.to_string_lossy().to_string())
}

/// Loads `source` in an off-screen window and prints it to `target`.
async fn render_pdf(
    app: &AppHandle,
    source: &Path,
    target: &Path,
    page: PdfPage,
) -> AppResult<()> {
    let url = tauri::Url::from_file_path(source)
        .map_err(|_| AppError::Message("导出页面的临时路径无效".into()))?;

    let (tx, mut rx) = unbounded_channel::<Result<(), String>>();
    // `on_page_load` is an `Fn`, so the sender is handed out once and the guard
    // makes that explicit.
    let pending = Arc::new(Mutex::new(Some(tx)));
    let target = target.to_path_buf();
    let label = format!("pdf-export-{}", std::process::id());

    let window = WebviewWindowBuilder::new(app, &label, WebviewUrl::External(url))
        .title("青简导出")
        // A hidden window is not an option: WebView2 suspends rendering for one,
        // which prints blank pages. So the window is real, but parked far outside
        // the desktop and kept out of the taskbar and the focus order.
        .position(-32_000.0, -32_000.0)
        .inner_size(900.0, 1200.0)
        .decorations(false)
        .skip_taskbar(true)
        .focused(false)
        .on_page_load(move |window, payload| {
            if payload.event() != tauri::webview::PageLoadEvent::Finished {
                return;
            }
            let Some(done) = pending.lock().ok().and_then(|mut slot| slot.take()) else {
                return;
            };
            print_now(window, target.clone(), page, done);
        })
        .build()
        .map_err(|error| AppError::Message(format!("无法创建导出窗口：{error}")))?;

    let outcome = match tokio::time::timeout(TIMEOUT, rx.recv()).await {
        Ok(Some(result)) => result.map_err(AppError::Message),
        Ok(None) => Err(AppError::Message("导出窗口在写入 PDF 之前被关闭".into())),
        Err(_) => Err(AppError::Message("导出 PDF 超时，请重试".into())),
    };

    let _ = window.close();
    outcome
}

/// Hands the job to the webview's own thread, which is the only place the
/// WebView2 interfaces may be used.
fn print_now(window: WebviewWindow, target: PathBuf, page: PdfPage, done: Done) {
    let fallback = done.clone();

    let dispatched = window.with_webview(move |webview| {
        #[cfg(windows)]
        {
            unsafe { start_print(&webview, &target, page, done) }
        }
        #[cfg(not(windows))]
        {
            let _ = webview;
            let _ = done.send(Err("静默导出 PDF 目前只支持 Windows".to_string()));
        }
    });

    if let Err(error) = dispatched {
        let _ = fallback.send(Err(format!("无法开始导出：{error}")));
    }
}

/// The COM calls. Every early failure still answers the command, or it would wait
/// out the whole timeout for nothing.
#[cfg(windows)]
unsafe fn start_print(
    webview: &tauri::webview::PlatformWebview,
    target: &Path,
    page: PdfPage,
    done: Done,
) {
    let fallback = done.clone();
    let started = unsafe { begin(webview, target, page, done) };

    if let Err(message) = started {
        let _ = fallback.send(Err(message));
    }
}

#[cfg(windows)]
unsafe fn begin(
    webview: &tauri::webview::PlatformWebview,
    target: &Path,
    page: PdfPage,
    done: Done,
) -> Result<(), String> {
    let core = webview
        .controller()
        .CoreWebView2()
        .map_err(|error| format!("无法访问 WebView2：{error}"))?;
    // `PrintToPdf` arrived with the WebView2 SDK 1.0.1108. An older runtime is
    // reported rather than silently ignored.
    let core: ICoreWebView2_7 = core
        .cast()
        .map_err(|_| "当前 WebView2 运行时过旧，无法静默导出 PDF".to_string())?;

    let environment: ICoreWebView2Environment6 = webview
        .environment()
        .cast()
        .map_err(|error| format!("无法读取打印环境：{error}"))?;
    let settings = environment
        .CreatePrintSettings()
        .map_err(|error| format!("无法创建打印设置：{error}"))?;
    apply_page(&settings, page)?;

    let path: Vec<u16> = target
        .as_os_str()
        .encode_wide()
        .chain(std::iter::once(0))
        .collect();

    let handler = PrintToPdfCompletedHandler::create(Box::new(move |error_code, succeeded| {
        let outcome = match (error_code, succeeded) {
            (Ok(()), true) => Ok(()),
            (Ok(()), false) => Err("WebView2 没有写出 PDF".to_string()),
            (Err(error), _) => Err(format!("导出 PDF 失败：{error}")),
        };
        let _ = done.send(outcome);
        Ok(())
    }));

    core.PrintToPdf(PCWSTR(path.as_ptr()), &settings, &handler)
        .map_err(|error| format!("导出 PDF 失败：{error}"))
}

#[cfg(windows)]
unsafe fn apply_page(settings: &ICoreWebView2PrintSettings, page: PdfPage) -> Result<(), String> {
    let failed = |error: windows_core::Error| format!("无法设置打印参数：{error}");

    settings.SetPageWidth(page.width).map_err(failed)?;
    settings.SetPageHeight(page.height).map_err(failed)?;
    // The inset is already carried by the rendered page's own body padding, so
    // asking for margins here as well would add them a second time. Chromium's
    // PDF writer takes margins from these settings, not from `@page`, which is
    // exactly why `render_html` zeroes the page margin and keeps the inset in the
    // flow — that way the file, a browser print and this path agree.
    settings.SetMarginTop(0.0).map_err(failed)?;
    settings.SetMarginBottom(0.0).map_err(failed)?;
    settings.SetMarginLeft(0.0).map_err(failed)?;
    settings.SetMarginRight(0.0).map_err(failed)?;
    // Code blocks and table headers carry a background; without this they print
    // as white boxes.
    settings.SetShouldPrintBackgrounds(true).map_err(failed)?;
    // And no URL, date or page number in the margin.
    settings.SetShouldPrintHeaderAndFooter(false).map_err(failed)?;
    Ok(())
}

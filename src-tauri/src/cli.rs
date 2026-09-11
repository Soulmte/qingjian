//! 命令行交给青简的东西。
//!
//! 注册了文件关联之后，在资源管理器里双击一个 `.md`，系统执行的是
//! `qingjian.exe "C:\...\笔记.md"` —— 文件路径就是第一个参数（安装包里
//! NSIS 写的就是 `"exe" "%1"`）。这里负责把它认出来，先存进状态，等前端
//! 启动完成后来取（见 `state::take_open_file`）。

use std::path::Path;

use crate::services;

/// 判断一个参数像不像「要打开的文件」。
///
/// 比 `services::is_markdown` 宽松一点：多认一个 `.txt`，因为「打开文件」
/// 对话框的过滤器本来就接受 txt，用户从「打开方式」里指过来的也可能是 txt。
fn is_openable(path: &Path) -> bool {
    if services::is_markdown(path) {
        return true;
    }
    path.extension()
        .and_then(|ext| ext.to_str())
        .map(|ext| ext.eq_ignore_ascii_case("txt"))
        .unwrap_or(false)
}

/// 从命令行参数里找出要打开的文件，认不出来就返回 `None`。
///
/// 只接受**确实存在**且扩展名眼熟的参数：
/// - 跳过空参数与以 `-` 开头的（那是开关，不是路径）
/// - 跳过不存在的（Windows 会把 `%1` 原样传进来，也可能指向刚被删掉的文件）
///
/// 认不出来不是错误：程序照常开一个空窗口，和手动点图标启动没区别。
pub fn markdown_path_in_args<I: IntoIterator<Item = String>>(args: I) -> Option<String> {
    args.into_iter().find_map(|argument| {
        let candidate = argument.trim();
        if candidate.is_empty() || candidate.starts_with('-') {
            return None;
        }

        let path = Path::new(candidate);
        if !path.is_file() || !is_openable(path) {
            return None;
        }

        Some(candidate.to_string())
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::fs;

    fn temp_file(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join("qingjian-cli-tests");
        fs::create_dir_all(&dir).unwrap();
        let path = dir.join(name);
        fs::write(&path, "# hello\n").unwrap();
        path
    }

    fn args(items: &[&std::path::Path]) -> Vec<String> {
        items.iter().map(|p| p.to_string_lossy().into_owned()).collect()
    }

    #[test]
    fn finds_the_file_after_the_program_path() {
        let file = temp_file("note.md");
        // Windows 双击时给的是：程序路径 + 文件路径
        let candidates = vec![
            "C:\\Program Files\\青简\\qingjian.exe".to_string(),
            file.to_string_lossy().into_owned(),
        ];
        assert_eq!(
            markdown_path_in_args(candidates),
            Some(file.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn ignores_paths_that_do_not_exist() {
        let missing = std::env::temp_dir().join("qingjian-cli-tests").join("gone.md");
        assert_eq!(markdown_path_in_args(args(&[&missing])), None);
    }

    #[test]
    fn ignores_switches_and_other_extensions() {
        let text = temp_file("note.md");
        let image = temp_file("shot.png");
        let switches = vec!["--flag".to_string(), image.to_string_lossy().into_owned()];
        assert_eq!(markdown_path_in_args(switches), None);
        // 开关之后仍然能认出真正的目标
        let mixed = vec![
            "--flag".to_string(),
            image.to_string_lossy().into_owned(),
            text.to_string_lossy().into_owned(),
        ];
        assert_eq!(
            markdown_path_in_args(mixed),
            Some(text.to_string_lossy().into_owned())
        );
    }

    #[test]
    fn accepts_txt_and_markdown() {
        for name in ["plain.txt", "doc.markdown", "UPPER.MD"] {
            let path = temp_file(name);
            assert!(
                markdown_path_in_args(args(&[&path])).is_some(),
                "{name} 应该被认得出来"
            );
        }
    }

    #[test]
    fn an_empty_command_line_is_not_an_error() {
        assert_eq!(markdown_path_in_args(Vec::new()), None);
        assert_eq!(markdown_path_in_args(vec!["".to_string()]), None);
    }
}

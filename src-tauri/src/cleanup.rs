//! 启动时顺手做的一点清理。
//!
//! 自动更新器把安装包写进系统临时目录里的
//! `{产品名}-{版本}-updater-*\{产品名}-{版本}-installer.exe`，然后启动安装程序、
//! 直接 `exit` 掉自己。进程是强退的，临时文件的析构不会跑，那个目录就留在了
//! `%TEMP%`。安装程序装完默认会把青简重新拉起来，新版本启动时在这里把它删掉，
//! 用户就不必自己清临时目录了。

use std::path::Path;

/// 删掉上一次更新留在临时目录里的安装包。尽力而为，失败不打扰任何人。
pub fn remove_stale_updater_dirs(app_name: &str) {
    remove_stale_updater_dirs_in(&std::env::temp_dir(), app_name);
}

fn remove_stale_updater_dirs_in(root: &Path, app_name: &str) {
    let prefix = format!("{app_name}-");
    let Ok(entries) = std::fs::read_dir(root) else {
        return;
    };
    for entry in entries.flatten() {
        let path = entry.path();
        // 只认「本产品名 + … + updater」这个形状，避免误伤别的程序留在临时目录里的东西
        if path.is_dir() && is_our_updater_dir(&path, &prefix) {
            // 删不掉就算了：可能另一个实例正在装，或者权限不够
            let _ = std::fs::remove_dir_all(&path);
        }
    }
}

fn is_our_updater_dir(path: &Path, prefix: &str) -> bool {
    path.file_name()
        .and_then(|name| name.to_str())
        .is_some_and(|name| name.starts_with(prefix) && name.contains("-updater-"))
}

#[cfg(test)]
mod tests {
    use super::*;

    fn scratch(name: &str) -> std::path::PathBuf {
        let dir = std::env::temp_dir().join(format!("qingjian-cleanup-test-{name}-{}", std::process::id()));
        let _ = std::fs::remove_dir_all(&dir);
        std::fs::create_dir_all(&dir).unwrap();
        dir
    }

    #[test]
    fn only_this_products_updater_dirs_match() {
        let prefix = "青简-";
        assert!(is_our_updater_dir(Path::new("/tmp/青简-0.1.3-updater-a1b2"), prefix));
        // 别的程序、别的形状都不动
        assert!(!is_our_updater_dir(Path::new("/tmp/Other-0.1.3-updater-a1b2"), prefix));
        assert!(!is_our_updater_dir(Path::new("/tmp/青简-0.1.3-installer"), prefix));
        assert!(!is_our_updater_dir(Path::new("/tmp/青简-backup"), prefix));
    }

    #[test]
    fn stale_installer_dirs_are_removed_and_bystanders_kept() {
        let root = scratch("sweep");
        let stale = root.join("青简-0.1.3-updater-deadbeef");
        let bystander = root.join("SomeoneElse-9.9.9-updater-cafe");
        let plain = root.join("青简-notes");
        std::fs::create_dir_all(&stale).unwrap();
        std::fs::write(stale.join("青简-0.1.3-installer.exe"), b"payload").unwrap();
        std::fs::create_dir_all(&bystander).unwrap();
        std::fs::create_dir_all(&plain).unwrap();

        remove_stale_updater_dirs_in(&root, "青简");

        assert!(!stale.exists());
        assert!(bystander.exists());
        assert!(plain.exists());

        let _ = std::fs::remove_dir_all(&root);
    }
}

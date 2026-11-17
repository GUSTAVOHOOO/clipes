//! Acesso ao cofre de credenciais do sistema (`keyring`), com isolamento opcional por arquivo
//! (`CLIPES_TEST_VAULT_FILE`) estritamente em builds de depuração (`#[cfg(debug_assertions)]`).
//! Em builds de release, apenas `keyring::Entry` é compilado.

#[cfg(debug_assertions)]
mod file_vault {
    use std::{
        collections::HashMap,
        fs,
        io::Write,
        path::{Path, PathBuf},
        sync::Mutex,
    };

    static LOCK: Mutex<()> = Mutex::new(());

    pub(super) fn active_path() -> Option<PathBuf> {
        std::env::var_os("CLIPES_TEST_VAULT_FILE")
            .filter(|v| !v.is_empty())
            .map(PathBuf::from)
    }

    fn entry_key(service: &str, account: &str) -> String {
        format!("{service}:{account}")
    }

    fn read_map(path: &Path) -> Result<HashMap<String, String>, ()> {
        match fs::read(path) {
            Ok(bytes) => serde_json::from_slice(&bytes).map_err(|_| ()),
            Err(e) if e.kind() == std::io::ErrorKind::NotFound => Ok(HashMap::new()),
            Err(_) => Err(()),
        }
    }

    fn write_map(path: &Path, map: &HashMap<String, String>) -> Result<(), ()> {
        let parent = path
            .parent()
            .filter(|p| !p.as_os_str().is_empty())
            .unwrap_or_else(|| Path::new("."));
        fs::create_dir_all(parent).map_err(|_| ())?;
        let mut tmp = tempfile::NamedTempFile::new_in(parent).map_err(|_| ())?;
        serde_json::to_writer(&mut tmp, map).map_err(|_| ())?;
        tmp.flush().map_err(|_| ())?;
        tmp.persist(path).map_err(|_| ())?;
        Ok(())
    }

    pub(super) fn get(path: &Path, service: &str, account: &str) -> Result<Option<String>, ()> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let map = read_map(path)?;
        Ok(map.get(&entry_key(service, account)).cloned())
    }

    pub(super) fn set(path: &Path, service: &str, account: &str, secret: &str) -> Result<(), ()> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = read_map(path)?;
        map.insert(entry_key(service, account), secret.to_owned());
        write_map(path, &map)
    }

    pub(super) fn remove(path: &Path, service: &str, account: &str) -> Result<(), ()> {
        let _guard = LOCK.lock().unwrap_or_else(|e| e.into_inner());
        let mut map = read_map(path)?;
        map.remove(&entry_key(service, account));
        write_map(path, &map)
    }

    #[cfg(test)]
    mod tests {
        use super::*;

        #[test]
        fn file_vault_roundtrip_and_remove() {
            let dir = tempfile::tempdir().unwrap();
            let path = dir.path().join("nested").join("vault.json");
            assert_eq!(get(&path, "svc", "acc").unwrap(), None);
            set(&path, "svc", "acc", "secret-1234").unwrap();
            set(&path, "svc", "other", "keep-5678").unwrap();
            assert_eq!(
                get(&path, "svc", "acc").unwrap().as_deref(),
                Some("secret-1234")
            );
            remove(&path, "svc", "acc").unwrap();
            assert_eq!(get(&path, "svc", "acc").unwrap(), None);
            assert_eq!(
                get(&path, "svc", "other").unwrap().as_deref(),
                Some("keep-5678")
            );
            remove(&path, "svc", "missing").unwrap();
        }
    }
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn get(service: &str, account: &str) -> Result<Option<String>, ()> {
    #[cfg(debug_assertions)]
    if let Some(path) = file_vault::active_path() {
        return file_vault::get(&path, service, account);
    }
    match keyring::Entry::new(service, account).and_then(|e| e.get_password()) {
        Ok(secret) => Ok(Some(secret)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(()),
    }
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn set(service: &str, account: &str, secret: &str) -> Result<(), ()> {
    #[cfg(debug_assertions)]
    if let Some(path) = file_vault::active_path() {
        return file_vault::set(&path, service, account, secret);
    }
    keyring::Entry::new(service, account)
        .and_then(|e| e.set_password(secret))
        .map_err(|_| ())
}

#[cfg_attr(test, allow(dead_code))]
pub(crate) fn remove(service: &str, account: &str) -> Result<(), ()> {
    #[cfg(debug_assertions)]
    if let Some(path) = file_vault::active_path() {
        return file_vault::remove(&path, service, account);
    }
    match keyring::Entry::new(service, account).and_then(|e| e.delete_credential()) {
        Ok(()) | Err(keyring::Error::NoEntry) => Ok(()),
        Err(_) => Err(()),
    }
}

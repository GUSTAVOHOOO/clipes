//! Chave do Motor Groq: um item próprio no cofre global do sistema.
use super::*;

#[cfg(test)]
static KEY: std::sync::Mutex<Option<String>> = std::sync::Mutex::new(None);

#[cfg(not(test))]
fn entry() -> Result<keyring::Entry, CoreError> {
    keyring::Entry::new("io.github.gustavohooo.clipes.transcription", "groq")
        .map_err(|_| error("vault", "Não foi possível acessar o cofre do sistema."))
}
#[cfg(not(test))]
fn get_key() -> Result<Option<String>, CoreError> {
    match entry()?.get_password() {
        Ok(key) => Ok(Some(key)),
        Err(keyring::Error::NoEntry) => Ok(None),
        Err(_) => Err(error(
            "vault",
            "Não foi possível acessar o cofre do sistema.",
        )),
    }
}
#[cfg(test)]
fn get_key() -> Result<Option<String>, CoreError> {
    Ok(KEY.lock().unwrap().clone())
}

fn status(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    Ok(json!({"configured": get_key()?.is_some()}))
}
fn set(v: Value, _: &mut EventSink<'_>) -> CommandResult {
    let key = v["key"]
        .as_str()
        .map(str::trim)
        .filter(|s| !s.is_empty())
        .ok_or_else(|| error("invalid_key", "Informe a chave do Groq."))?;
    #[cfg(not(test))]
    entry()?
        .set_password(key)
        .map_err(|_| error("vault", "Não foi possível salvar a chave no cofre."))?;
    #[cfg(test)]
    {
        *KEY.lock().unwrap() = Some(key.to_owned());
    }
    Ok(json!({"configured": true}))
}
fn remove(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    #[cfg(not(test))]
    match entry()?.delete_credential() {
        Ok(()) | Err(keyring::Error::NoEntry) => (),
        Err(_) => return Err(error("vault", "Não foi possível remover a chave do cofre.")),
    }
    #[cfg(test)]
    {
        *KEY.lock().unwrap() = None;
    }
    Ok(json!({"configured": false}))
}
inventory::submit! { CommandRegistration { name: "transcription.groq.key.status", execute: status } }
inventory::submit! { CommandRegistration { name: "transcription.groq.key.set", execute: set } }
inventory::submit! { CommandRegistration { name: "transcription.groq.key.remove", execute: remove } }

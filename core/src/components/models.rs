//! Modelos de transcrição e detecção como Componentes (ADR-0003, regra 2):
//! revisão fixa do Hugging Face/GitHub, tamanho e SHA-256 de cada arquivo (atualizáveis via
//! catálogo remoto assinado em `catalog.rs` com fallback embutido), consentimento antes do
//! download, licença e `source_url` na tela. Ficam em `<dados>/models/<id>/`.
//! O arquivo `model.state.json` só é escrito depois de todos os arquivos conferidos.
//!
//! Os modelos não entram no CI: nenhum teste os baixa da rede real.

use super::catalog::{load_active_catalog, CatalogModel};
use super::*;

const MARKER: &str = "model.state.json";
const STAGE_DIGEST: &str = ".stage_digest";

pub(crate) const TURBO_ID: &str = "whisper-turbo";
pub(crate) const SMALL_ID: &str = "whisper-small";
pub(crate) const YUNET_ID: &str = "yunet";

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ModelFileSpec {
    pub name: String,
    pub size: u64,
    pub sha256: String,
}

#[derive(Clone, Debug, PartialEq, Eq)]
pub(crate) struct ModelSpec {
    pub id: String,
    pub label: String,
    /// Repositório canônico atual no Hugging Face ou GitHub.
    pub repo: String,
    /// Nome anterior do repositório, citado no benchmark #32.
    pub former_repo: Option<String>,
    pub revision: String,
    pub license: String,
    pub device: String,
    /// Arquivos conferidos por tamanho e SHA-256 em cada download.
    pub files: Vec<ModelFileSpec>,
}

impl From<&CatalogModel> for ModelSpec {
    fn from(m: &CatalogModel) -> Self {
        Self {
            id: m.id.clone(),
            label: m.label.clone(),
            repo: m.repo.clone(),
            former_repo: m.former_repo.clone(),
            revision: m.revision.clone(),
            license: m.license.clone(),
            device: m.device.clone(),
            files: m
                .files
                .iter()
                .map(|f| ModelFileSpec {
                    name: f.name.clone(),
                    size: f.size,
                    sha256: f.sha256.clone(),
                })
                .collect(),
        }
    }
}

pub(crate) fn all(settings: &Settings) -> Vec<ModelSpec> {
    load_active_catalog(settings)
        .manifest
        .models
        .iter()
        .map(ModelSpec::from)
        .collect()
}

pub(crate) fn find_model(settings: &Settings, id: &str) -> Option<ModelSpec> {
    all(settings).into_iter().find(|m| m.id == id)
}

pub(crate) fn small_spec(settings: &Settings) -> ModelSpec {
    find_model(settings, SMALL_ID).expect("catálogo sempre inclui whisper-small")
}

pub(crate) fn turbo_spec(settings: &Settings) -> ModelSpec {
    find_model(settings, TURBO_ID).expect("catálogo sempre inclui whisper-turbo")
}

pub(crate) fn reframe_model() -> Result<(PathBuf, &'static str), CoreError> {
    let settings = load_settings()?;
    let yunet = find_model(&settings, YUNET_ID)
        .ok_or_else(|| error("model_missing", "Instale o modelo YuNet em Componentes."))?;
    let path = yunet.dir(&settings).join(&yunet.files[0].name);
    if !yunet.is_installed_on_disk(&settings) || !path.is_file() {
        return Err(error(
            "model_missing",
            "Instale o modelo YuNet em Componentes.",
        ));
    }
    Ok((
        path,
        if super::worker::cuda_installed(&settings) {
            "cuda"
        } else {
            "cpu"
        },
    ))
}

fn is_valid_hex_revision(rev: &str) -> bool {
    rev.len() == 40 && rev.bytes().all(|b| b.is_ascii_hexdigit())
}

fn test_model_base_url() -> Option<String> {
    if !crate::paths::is_cargo_test_binary() {
        return None;
    }
    let raw = std::env::var("CLIPES_TEST_MODEL_BASE_URL").ok()?;
    let url = reqwest::Url::parse(raw.trim()).ok()?;
    let loopback =
        url.scheme() == "http" && matches!(url.host_str(), Some("127.0.0.1" | "localhost" | "::1"));
    loopback.then(|| raw.trim().trim_end_matches('/').to_owned())
}

impl ModelSpec {
    pub(crate) fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.size).sum()
    }

    pub(crate) fn source_url(&self) -> String {
        if self.id == YUNET_ID {
            return format!(
                "https://github.com/{}/tree/{}/models/face_detection_yunet",
                self.repo, self.revision
            );
        }
        format!(
            "https://huggingface.co/{}/tree/{}",
            self.repo, self.revision
        )
    }

    pub(crate) fn file_url(&self, name: &str) -> String {
        if let Some(base) = test_model_base_url() {
            return format!("{base}/{}/{name}", self.id);
        }
        if self.id == YUNET_ID {
            return format!(
                "https://media.githubusercontent.com/media/{}/{}/models/face_detection_yunet/{name}",
                self.repo, self.revision
            );
        }
        format!(
            "https://huggingface.co/{}/resolve/{}/{name}",
            self.repo, self.revision
        )
    }

    pub(crate) fn dir(&self, settings: &Settings) -> PathBuf {
        settings.data_dir.join("models").join(&self.id)
    }

    pub(crate) fn files_digest(&self) -> String {
        let mut h = Sha256::new();
        h.update(self.revision.as_bytes());
        for f in &self.files {
            h.update(b"\0");
            h.update(f.name.as_bytes());
            h.update(f.size.to_le_bytes());
            h.update(f.sha256.as_bytes());
        }
        format!("{:x}", h.finalize())
    }

    fn read_state(&self, settings: &Settings) -> Option<Value> {
        fs::read(self.dir(settings).join(MARKER))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
    }

    pub(crate) fn installed_revision(&self, settings: &Settings) -> Option<String> {
        let state = self.read_state(settings)?;
        let rev = state["revision"].as_str()?;
        is_valid_hex_revision(rev).then(|| rev.to_owned())
    }

    /// Verdadeiro quando o modelo já está instalado no disco (mesmo de uma revisão anterior).
    pub(crate) fn is_installed_on_disk(&self, settings: &Settings) -> bool {
        self.installed_revision(settings).is_some()
    }

    /// Verdadeiro apenas quando a revisão instalada coincide exatamente com a do catálogo atual.
    #[cfg(test)]
    pub(crate) fn installed(&self, settings: &Settings) -> bool {
        self.installed_revision(settings).as_deref() == Some(self.revision.as_str())
    }

    pub(crate) fn update_available(&self, settings: &Settings) -> bool {
        let Some(state) = self.read_state(settings) else {
            return false;
        };
        let Some(rev) = state["revision"]
            .as_str()
            .filter(|r| is_valid_hex_revision(r))
        else {
            return false;
        };
        if rev != self.revision {
            return true;
        }
        state["files_digest"]
            .as_str()
            .is_some_and(|digest| digest != self.files_digest())
    }
}

/// O modelo em uso: a escolha manual, a da sonda de hardware (#50) ou a de fábrica
/// (turbo com o worker CUDA, `small` em CPU).
pub(crate) fn recommended(settings: &Settings) -> ModelSpec {
    super::hardware::effective(settings)
        .spec(settings)
        .unwrap_or_else(|| small_spec(settings))
}

pub(crate) struct Selection {
    pub spec: ModelSpec,
    pub dir: PathBuf,
    pub config: super::hardware::Config,
}

/// A configuração do modelo já fixado numa Transcrição (#50): o modelo não muda na retomada.
pub(crate) fn selection_for(model_id: &str) -> Result<Selection, CoreError> {
    let settings = load_settings()?;
    let spec = find_model(&settings, model_id).ok_or_else(|| {
        error(
            "model_missing",
            "O modelo de transcrição não está instalado; baixe-o em Componentes.",
        )
    })?;
    let config = super::hardware::config_for_model(&settings, model_id).ok_or_else(|| {
        error(
            "model_missing",
            "O modelo de transcrição não está disponível neste hardware.",
        )
    })?;
    if !spec.is_installed_on_disk(&settings) {
        return Err(error(
            "model_missing",
            "O modelo de transcrição não está instalado; baixe-o em Componentes.",
        ));
    }
    Ok(Selection {
        dir: spec.dir(&settings),
        spec,
        config,
    })
}

/// A configuração em uso (modelo, dispositivo e precisão), se o modelo já estiver instalado.
pub(crate) fn selection() -> Result<Selection, CoreError> {
    let settings = load_settings()?;
    let config = super::hardware::effective(&settings);
    let spec = config
        .spec(&settings)
        .unwrap_or_else(|| small_spec(&settings));
    if !spec.is_installed_on_disk(&settings) {
        return Err(error(
            "model_missing",
            "O modelo de transcrição não está instalado; baixe-o em Componentes.",
        ));
    }
    Ok(Selection {
        dir: spec.dir(&settings),
        spec,
        config,
    })
}

/// Redirecionamentos só para o Hugging Face e seu CDN, sempre por HTTPS.
fn allowed_redirect(url: &reqwest::Url) -> bool {
    if let Some(base) = test_model_base_url().and_then(|raw| reqwest::Url::parse(&raw).ok()) {
        if url.scheme() == base.scheme()
            && url.host_str() == base.host_str()
            && url.port_or_known_default() == base.port_or_known_default()
        {
            return true;
        }
    }
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && (host == "media.githubusercontent.com"
            || ["huggingface.co", "hf.co"]
                .iter()
                .any(|root| host == *root || host.ends_with(&format!(".{root}"))))
}

fn client() -> Result<reqwest::blocking::Client, CoreError> {
    reqwest::blocking::Client::builder()
        .redirect(reqwest::redirect::Policy::custom(|attempt| {
            if attempt.previous().len() >= 5 || !allowed_redirect(attempt.url()) {
                attempt.error("redirecionamento não permitido")
            } else {
                attempt.follow()
            }
        }))
        .build()
        .map_err(|_| error("download", "Não foi possível iniciar o download."))
}

fn manifest(_: Value, _: &mut EventSink<'_>) -> CommandResult {
    let settings = load_settings()?;
    let active = load_active_catalog(&settings);
    let models: Vec<ModelSpec> = active.manifest.models.iter().map(ModelSpec::from).collect();
    let wanted = recommended(&settings).id;
    let worker_installed = super::worker::installed(&settings);
    Ok(json!(models
        .iter()
        .map(|m| {
            let installed_rev = m.installed_revision(&settings);
            let installed = installed_rev.is_some();
            let update_available = m.update_available(&settings);
            json!({
                "id": m.id,
                "label": m.label,
                "repo": m.repo,
                "former_repo": m.former_repo,
                "revision": m.revision,
                "license": m.license,
                "source_url": m.source_url(),
                "size": m.total_size(),
                "device": m.device,
                "files": m.files.iter().map(|f| json!({"name": f.name, "size": f.size, "sha256": f.sha256})).collect::<Vec<_>>(),
                "installed": installed,
                "installed_revision": installed_rev,
                "update_available": update_available,
                "worker_installed": worker_installed,
                "recommended": m.id == wanted,
                "catalog_version": active.manifest.version,
                "catalog_source": active.source.as_str(),
            })
        })
        .collect::<Vec<_>>()))
}

fn download(v: Value, events: &mut EventSink<'_>) -> CommandResult {
    if v["confirmed"] != true {
        return Err(error(
            "confirmation_required",
            "Confirme o download antes de iniciar",
        ));
    }
    let id = v["id"].as_str().unwrap_or("");
    let settings = load_settings()?;
    let active = load_active_catalog(&settings);
    let spec = active
        .manifest
        .models
        .iter()
        .find(|m| m.id == id)
        .map(ModelSpec::from)
        .ok_or_else(|| error("unknown_component", "Componente indisponível"))?;
    if !super::worker::installed(&settings) {
        return Err(error(
            "worker_missing",
            "Instale o worker de ML antes de baixar o modelo.",
        ));
    }
    let flag = Arc::new(AtomicBool::new(false));
    {
        let mut map = jobs().lock().unwrap();
        if map.contains_key(id) {
            return Err(error("already_downloading", "Download em andamento"));
        }
        map.insert(id.into(), flag.clone());
    }
    let result = download_model(&spec, active.manifest.version, &settings, &flag, events);
    if result.as_ref().is_err_and(|e| e.code != "cancelled") {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::ComponentFailure);
    }
    jobs().lock().unwrap().remove(id);
    result
}

fn download_model(
    spec: &ModelSpec,
    catalog_version: u64,
    settings: &Settings,
    cancel: &AtomicBool,
    events: &mut EventSink<'_>,
) -> CommandResult {
    let client = client()?;
    let root = settings.data_dir.join("models");
    let stage = root.join(format!("{}.part", spec.id));
    let digest = spec.files_digest();
    let stage_marker = stage.join(STAGE_DIGEST);
    if stage.exists() {
        let same_stage = fs::read_to_string(&stage_marker)
            .ok()
            .is_some_and(|s| s.trim() == digest);
        if !same_stage {
            let _ = fs::remove_dir_all(&stage);
        }
    }
    fs::create_dir_all(&stage)
        .map_err(|_| error("download", "Não foi possível gravar o modelo."))?;
    fs::write(&stage_marker, &digest)
        .map_err(|_| error("download", "Não foi possível gravar o modelo."))?;

    let total = spec.total_size().max(1);
    let mut done = 0u64;
    for file in &spec.files {
        let base = done;
        fetch_with(
            &client,
            &spec.file_url(&file.name),
            &file.sha256,
            file.size,
            &stage.join(&file.name),
            cancel,
            |percentage| {
                events(ProgressEvent {
                    project: None,
                    clip_id: None,
                    job: spec.id.clone(),
                    stage: "download".into(),
                    percentage: ((base + file.size * u64::from(percentage) / 100) * 100 / total)
                        .min(99) as u8,
                    message: "Baixando modelo".into(),
                    error: None,
                })
            },
        )?;
        done += file.size;
    }
    let _ = fs::remove_file(&stage_marker);

    let dir = spec.dir(settings);
    let backup = root.join(format!("{}.old", spec.id));
    let _ = fs::remove_dir_all(&backup);
    let had_existing = dir.exists();
    if had_existing {
        fs::rename(&dir, &backup)
            .map_err(|_| error("install", "Não foi possível instalar o modelo."))?;
    }
    let install_res = (|| -> Result<(), CoreError> {
        fs::rename(&stage, &dir)
            .map_err(|_| error("install", "Não foi possível instalar o modelo."))?;
        fs::write(
            dir.join(MARKER),
            serde_json::to_vec_pretty(&json!({
                "revision": spec.revision,
                "repo": spec.repo,
                "files_digest": digest,
                "catalog_version": catalog_version,
            }))
            .unwrap(),
        )
        .map_err(|_| error("install", "Não foi possível instalar o modelo."))?;
        Ok(())
    })();
    if let Err(err) = install_res {
        let _ = fs::remove_dir_all(&dir);
        if had_existing {
            let _ = fs::rename(&backup, &dir);
        }
        return Err(err);
    }
    if had_existing {
        let _ = fs::remove_dir_all(&backup);
    }

    events(ProgressEvent {
        project: None,
        clip_id: None,
        job: spec.id.clone(),
        stage: "complete".into(),
        percentage: 100,
        message: "Modelo instalado".into(),
        error: None,
    });
    Ok(json!({"id": spec.id}))
}

inventory::submit! { CommandRegistration { name: "components.models.manifest", execute: manifest } }
inventory::submit! { CommandRegistration { name: "components.models.download", execute: download } }

#[cfg(test)]
mod tests {
    use super::*;

    fn test_settings(root: &Path) -> Settings {
        Settings {
            data_dir: root.into(),
            cache_dir: root.join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: None,
        }
    }

    #[test]
    fn model_files_are_pinned_by_revision_and_sha256() {
        let root = tempfile::tempdir().unwrap();
        let settings = test_settings(root.path());
        let models = all(&settings);
        for m in &models {
            assert_eq!(m.revision.len(), 40);
            assert!(m
                .files
                .iter()
                .any(|f| f.name == "model.bin" || f.name.ends_with(".onnx")));
            for f in &m.files {
                assert!(f.size > 0 && f.sha256.len() == 64, "{}", f.name);
                assert!(f.sha256.bytes().all(|b| b.is_ascii_hexdigit()));
            }
            assert!(m.file_url("model.bin").contains(&m.revision));
        }
        let turbo = turbo_spec(&settings);
        assert_eq!(
            turbo.former_repo.as_deref(),
            Some("mobiuslabsgmbh/faster-whisper-large-v3-turbo")
        );
    }

    #[test]
    fn redirects_only_reach_hugging_face_and_its_cdn_over_https() {
        let ok = |u: &str| allowed_redirect(&u.parse().unwrap());
        assert!(ok("https://huggingface.co/x"));
        assert!(ok("https://us.aws.cdn.hf.co/xet-bridge-us/abc"));
        assert!(ok("https://cdn-lfs.huggingface.co/a"));
        assert!(!ok("http://huggingface.co/x"));
        assert!(!ok("https://evilhuggingface.co/x"));
        assert!(!ok("https://huggingface.co.evil.example/x"));
        assert!(!ok("https://example.com/hf.co"));
    }

    #[test]
    fn installed_needs_the_marker_with_the_pinned_revision() {
        let root = tempfile::tempdir().unwrap();
        let settings = test_settings(root.path());
        let small = small_spec(&settings);
        assert!(!small.installed(&settings));
        fs::create_dir_all(small.dir(&settings)).unwrap();
        assert!(!small.installed(&settings));
        fs::write(
            small.dir(&settings).join(MARKER),
            br#"{"revision":"outra"}"#,
        )
        .unwrap();
        assert!(!small.installed(&settings));
        assert!(!small.is_installed_on_disk(&settings));
        fs::write(
            small.dir(&settings).join(MARKER),
            format!(r#"{{"revision":"{}"}}"#, small.revision),
        )
        .unwrap();
        assert!(small.installed(&settings));
        assert!(small.is_installed_on_disk(&settings));
        assert!(!small.update_available(&settings));
    }
}

//! Modelos de transcrição como Componentes (ADR-0003, regra 2): revisão fixa do
//! Hugging Face, tamanho e SHA-256 de cada arquivo, consentimento antes do download,
//! licença e `source_url` na tela. Dependem do worker instalado (#47) e ficam em
//! `<dados>/models/<id>/`. O arquivo `model.state.json` só é escrito depois de todos os
//! arquivos conferidos, e é ele que marca o modelo como instalado.
//!
//! Os modelos não entram no CI: nenhum teste os baixa.

use super::*;

const MARKER: &str = "model.state.json";

pub(crate) struct ModelSpec {
    pub id: &'static str,
    pub label: &'static str,
    /// Repositório canônico atual no Hugging Face.
    pub repo: &'static str,
    /// Nome anterior do repositório, citado no benchmark #32 (docs/research/2026-11-14-benchmark-transcricao.md).
    /// O Hugging Face o redireciona hoje; o download usa só o nome canônico.
    pub former_repo: Option<&'static str>,
    pub revision: &'static str,
    pub license: &'static str,
    pub device: &'static str,
    /// Arquivos `(nome, bytes, sha256)` conferidos em cada download.
    pub files: &'static [(&'static str, u64, &'static str)],
}

/// GPU NVIDIA: `large-v3-turbo` (conversão CTranslate2 de openai/whisper-large-v3-turbo, MIT).
/// Até a revisão fixada, o repositório era `mobiuslabsgmbh/faster-whisper-large-v3-turbo`.
pub(crate) const TURBO: ModelSpec = ModelSpec {
    id: "whisper-turbo",
    label: "Whisper large-v3-turbo (GPU NVIDIA)",
    repo: "dropbox-dash/faster-whisper-large-v3-turbo",
    former_repo: Some("mobiuslabsgmbh/faster-whisper-large-v3-turbo"),
    revision: "0a363e9161cbc7ed1431c9597a8ceaf0c4f78fcf",
    license: "MIT",
    device: "cuda",
    files: &[
        (
            "config.json",
            2263,
            "b0253ea6c0d3bea6b1e19e91a02acfd3b53f4467362efcb5a3e6b16c9b3a9b7e",
        ),
        (
            "model.bin",
            1_617_884_929,
            "e76620f83d5f5b69efd3d87e3dc180c1bd21df9fbebacfd4335e5e1efcc018da",
        ),
        (
            "preprocessor_config.json",
            340,
            "7ccc62c6f2765af1f3b46c00c9b5894426835a05021c8b9c01eecb6dfb542711",
        ),
        (
            "tokenizer.json",
            2_710_337,
            "297b13372ac43916285644fb9687add3cc62ee2a1adb60da3dc25cc94c1871fd",
        ),
        (
            "vocabulary.json",
            1_068_114,
            "c69260f2ab26d659b7c398f9a2b2b48ed0df16c3b47d7326782fd9cba71690c1",
        ),
    ],
};

/// CPU: `small` INT8 (conversão CTranslate2 de openai/whisper-small, MIT).
pub(crate) const SMALL: ModelSpec = ModelSpec {
    id: "whisper-small",
    label: "Whisper small (CPU)",
    repo: "Systran/faster-whisper-small",
    former_repo: None,
    revision: "536b0662742c02347bc0e980a01041f333bce120",
    license: "MIT",
    device: "cpu",
    files: &[
        (
            "config.json",
            2370,
            "b55496ac7940a7ae47d2c01eab40edfd8701feec1229d9cce3b40014383fb828",
        ),
        (
            "model.bin",
            483_546_902,
            "3e305921506d8872816023e4c273e75d2419fb89b24da97b4fe7bce14170d671",
        ),
        (
            "tokenizer.json",
            2_203_239,
            "fb7b63191e9bb045082c79fd742a3106a12c99513ab30df4a0d47fa6cb6fd0ab",
        ),
        (
            "vocabulary.txt",
            459_861,
            "34ce3fe1c5041027b3f8d42912270993f986dbc4bb34cf27f951e34a1e453913",
        ),
    ],
};

pub(crate) const MODELS: [&ModelSpec; 2] = [&TURBO, &SMALL];

impl ModelSpec {
    pub(crate) fn total_size(&self) -> u64 {
        self.files.iter().map(|f| f.1).sum()
    }
    fn source_url(&self) -> String {
        format!(
            "https://huggingface.co/{}/tree/{}",
            self.repo, self.revision
        )
    }
    fn file_url(&self, name: &str) -> String {
        format!(
            "https://huggingface.co/{}/resolve/{}/{name}",
            self.repo, self.revision
        )
    }
    pub(crate) fn dir(&self, settings: &Settings) -> PathBuf {
        settings.data_dir.join("models").join(self.id)
    }
    pub(crate) fn installed(&self, settings: &Settings) -> bool {
        fs::read(self.dir(settings).join(MARKER))
            .ok()
            .and_then(|bytes| serde_json::from_slice::<Value>(&bytes).ok())
            .is_some_and(|state| state["revision"] == self.revision)
    }
}

/// O modelo em uso: a escolha manual, a da sonda de hardware (#50) ou a de fábrica
/// (turbo com o worker CUDA, `small` em CPU).
pub(crate) fn recommended(settings: &Settings) -> &'static ModelSpec {
    super::hardware::effective(settings)
        .spec()
        .unwrap_or(&SMALL)
}

pub(crate) struct Selection {
    pub spec: &'static ModelSpec,
    pub dir: PathBuf,
    pub config: super::hardware::Config,
}

/// A configuração do modelo já fixado numa Transcrição (#50): o modelo não muda na retomada.
pub(crate) fn selection_for(model_id: &str) -> Result<Selection, CoreError> {
    let settings = load_settings()?;
    let spec = MODELS
        .into_iter()
        .find(|m| m.id == model_id)
        .ok_or_else(|| {
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
    if !spec.installed(&settings) {
        return Err(error(
            "model_missing",
            "O modelo de transcrição não está instalado; baixe-o em Componentes.",
        ));
    }
    Ok(Selection {
        spec,
        dir: spec.dir(&settings),
        config,
    })
}

/// A configuração em uso (modelo, dispositivo e precisão), se o modelo já estiver instalado.
pub(crate) fn selection() -> Result<Selection, CoreError> {
    let settings = load_settings()?;
    let config = super::hardware::effective(&settings);
    let spec = config.spec().unwrap_or(&SMALL);
    if !spec.installed(&settings) {
        return Err(error(
            "model_missing",
            "O modelo de transcrição não está instalado; baixe-o em Componentes.",
        ));
    }
    Ok(Selection {
        spec,
        dir: spec.dir(&settings),
        config,
    })
}

/// Redirecionamentos só para o Hugging Face e seu CDN, sempre por HTTPS.
fn allowed_redirect(url: &reqwest::Url) -> bool {
    let host = url.host_str().unwrap_or("");
    url.scheme() == "https"
        && ["huggingface.co", "hf.co"]
            .iter()
            .any(|root| host == *root || host.ends_with(&format!(".{root}")))
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
    let wanted = recommended(&settings).id;
    let worker_installed = super::worker::installed(&settings);
    Ok(json!(MODELS
        .iter()
        .map(|m| json!({
            "id": m.id,
            "label": m.label,
            "repo": m.repo,
            "former_repo": m.former_repo,
            "revision": m.revision,
            "license": m.license,
            "source_url": m.source_url(),
            "size": m.total_size(),
            "device": m.device,
            "files": m.files.iter().map(|f| json!({"name": f.0, "size": f.1, "sha256": f.2})).collect::<Vec<_>>(),
            "installed": m.installed(&settings),
            "worker_installed": worker_installed,
            "recommended": m.id == wanted,
        }))
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
    let spec = MODELS
        .iter()
        .find(|m| m.id == id)
        .ok_or_else(|| error("unknown_component", "Componente indisponível"))?;
    let settings = load_settings()?;
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
    let result = download_model(spec, &settings, &flag, events);
    if result.as_ref().is_err_and(|e| e.code != "cancelled") {
        crate::diagnostic::record(crate::diagnostic::DiagnosticEvent::ComponentFailure);
    }
    jobs().lock().unwrap().remove(id);
    result
}

fn download_model(
    spec: &ModelSpec,
    settings: &Settings,
    cancel: &AtomicBool,
    events: &mut EventSink<'_>,
) -> CommandResult {
    let client = client()?;
    let root = settings.data_dir.join("models");
    let stage = root.join(format!("{}.part", spec.id));
    fs::create_dir_all(&stage)
        .map_err(|_| error("download", "Não foi possível gravar o modelo."))?;
    let total = spec.total_size().max(1);
    let mut done = 0u64;
    for (name, size, sha256) in spec.files {
        let base = done;
        fetch_with(
            &client,
            &spec.file_url(name),
            sha256,
            *size,
            &stage.join(name),
            cancel,
            |percentage| {
                events(ProgressEvent {
                    project: None,
                    job: spec.id.into(),
                    stage: "download".into(),
                    percentage: ((base + size * u64::from(percentage) / 100) * 100 / total).min(99)
                        as u8,
                    message: "Baixando modelo".into(),
                    error: None,
                })
            },
        )?;
        done += size;
    }
    let dir = spec.dir(settings);
    let _ = fs::remove_dir_all(&dir);
    fs::rename(&stage, &dir)
        .map_err(|_| error("install", "Não foi possível instalar o modelo."))?;
    fs::write(
        dir.join(MARKER),
        serde_json::to_vec_pretty(&json!({"revision": spec.revision, "repo": spec.repo})).unwrap(),
    )
    .map_err(|_| error("install", "Não foi possível instalar o modelo."))?;
    events(ProgressEvent {
        project: None,
        job: spec.id.into(),
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

    #[test]
    fn model_files_are_pinned_by_revision_and_sha256() {
        for m in MODELS {
            assert_eq!(m.revision.len(), 40);
            assert!(m.files.iter().any(|f| f.0 == "model.bin"));
            for (name, size, sha) in m.files {
                assert!(*size > 0 && sha.len() == 64, "{name}");
                assert!(sha.bytes().all(|b| b.is_ascii_hexdigit()));
            }
            assert!(m.file_url("model.bin").contains(m.revision));
        }
        assert_eq!(
            TURBO.former_repo,
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
        let settings = Settings {
            data_dir: root.path().into(),
            cache_dir: root.path().join("cache"),
            cache_limit_bytes: 1,
            ffmpeg_path: None,
        };
        assert!(!SMALL.installed(&settings));
        fs::create_dir_all(SMALL.dir(&settings)).unwrap();
        assert!(!SMALL.installed(&settings));
        fs::write(
            SMALL.dir(&settings).join(MARKER),
            br#"{"revision":"outra"}"#,
        )
        .unwrap();
        assert!(!SMALL.installed(&settings));
        fs::write(
            SMALL.dir(&settings).join(MARKER),
            format!(r#"{{"revision":"{}"}}"#, SMALL.revision),
        )
        .unwrap();
        assert!(SMALL.installed(&settings));
    }
}

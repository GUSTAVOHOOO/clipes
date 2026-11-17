use std::{env, fs, io::{self, Write}, thread, time::Duration};
fn main() {
    let args: Vec<String> = env::args().collect();
    if args.get(1).map(String::as_str) == Some("--child") {
        thread::sleep(Duration::from_secs(2)); fs::write(&args[2], b"survived").unwrap(); return;
    }
    if args.get(1).map(String::as_str) == Some("--version") {
        if std::path::Path::new(&args[0]).with_file_name("version-hang").exists() { thread::sleep(Duration::from_secs(30)); }
        println!("2027.01.01.000000"); return;
    }

    if args.get(1).map(String::as_str) == Some("-v") {
        println!(r#"{{"format":{{"duration":"1.0"}},"streams":[{{"index":0,"codec_type":"audio"}}]}}"#);
        return;
    }

    // #203: o deno só chega ao yt-dlp quando a URL pede (`deno`/`probe-deno`) e nunca sem o Componente.
    if let Some(end) = args.iter().position(|a| a == "--") {
        let url = &args[end + 1];
        let js = args.iter().position(|a| a == "--js-runtimes");
        if url.ends_with("deno") && !url.ends_with("no-deno") {
            let i = js.expect("--js-runtimes ausente");
            let path = args[i + 1].strip_prefix("deno:").expect("formato deno:<caminho>");
            assert!(std::path::Path::new(path).is_absolute() && std::path::Path::new(path).is_file());
            assert!(i < end);
        } else {
            assert!(js.is_none(), "--js-runtimes sem o Componente");
        }
    }
    if args.iter().any(|a| a == "--skip-download") && !args.iter().any(|a| a == "--write-subs") {
        // Detecção prévia (#201): só metadados, sem cookies, sem baixar nada.
        assert!(args.iter().any(|a| a == "--ignore-config"));
        assert!(args.iter().any(|a| a == "--ignore-no-formats-error"));
        assert!(args.iter().any(|a| a == "--no-playlist"));
        assert!(!args.iter().any(|a| a.contains("cookies")));
        assert!(!args.iter().any(|a| a == "--no-simulate"));
        assert!(args.windows(2).any(|w| w == ["--print", "%(id)s|%(age_limit)s|%(availability)s|%(live_status)s|%(duration)s"]));
        let end = args.iter().position(|a| a == "--").unwrap();
        let url = &args[end + 1];
        if url.ends_with("probe-age") { println!("age123|18|needs_auth|not_live|120"); }
        else if url.ends_with("probe-net") { eprintln!("ERROR: Unable to download webpage: <urlopen error> C:/Users/Alice/secret"); std::process::exit(1); }
        else if url.ends_with("probe-junk") { println!("saida inesperada sem campos"); }
        else { println!("video123|0|public|not_live|120"); }
        return;
    }
    if args.iter().any(|a| a == "--skip-download") {
        // Modo do chat da live (#151): só o replay, nunca a mídia.
        assert!(args.iter().any(|a| a == "--write-subs"));
        assert!(args.windows(2).any(|w| w == ["--sub-langs", "live_chat"]));
        assert!(!args.iter().any(|a| a == "--no-simulate"));
        let end = args.iter().position(|a| a == "--").unwrap();
        let url = &args[end + 1];
        if url.ends_with("chat-fail") { eprintln!("secret path must not escape"); std::process::exit(1); }
        if url.ends_with("chat-hang") { thread::sleep(Duration::from_secs(30)); }
        if url.ends_with("chat-replay") || url.ends_with("chat-replay-deno") {
            let i = args.iter().position(|a| a == "-o").unwrap();
            let target = args[i + 1].replace("%(id)s", "video123").replace("%(ext)s", "live_chat.json");
            fs::copy(env::var("CLIPES_FAKE_CHAT_FILE").unwrap(), target).unwrap();
        }
        return;
    }
    assert!(!args.iter().any(|a| a == "--no-color"));
    assert!(args.windows(2).any(|w| w == ["--match-filters", "live_status !=? is_live & live_status !=? is_upcoming & live_status !=? post_live"]));

    assert!(args.windows(2).any(|w| w == ["--color", "never"]));
    assert!(args.iter().any(|a| a == "--no-simulate"));
    let i = args.iter().position(|a| a == "-o").unwrap();
    let end = args.iter().position(|a| a == "--").unwrap();
    let url = &args[end + 1];
    let target = args[i + 1].replace("%(id)s", "video123").replace("%(ext)s", "mp4");
    fs::write(&target, b"media").unwrap();
    if url.ends_with("hang-child") {
        let marker = std::path::Path::new(&target).parent().unwrap().parent().unwrap().join("child-survived");
        std::process::Command::new(&args[0]).arg("--child").arg(marker).spawn().unwrap();
    }

    println!("clipes-progress: 42.0%"); io::stdout().flush().unwrap();
    if url.ends_with("hang") || url.ends_with("hang-child") { thread::sleep(Duration::from_secs(30)); }
    let failure = if url.ends_with("age") { Some("ERROR: Sign in to confirm your age") }
        else if url.ends_with("login") { Some("ERROR: Sign in to confirm you are not a bot") }
        else if url.ends_with("js") { Some("WARNING: No supported JavaScript runtime could be found") }
        else if url.ends_with("sabr") { Some("WARNING: YouTube may have enabled the SABR-only streaming experiment") }
        else if url.ends_with("fail") { Some("ERROR: HTTP Error 403: Forbidden") }
        else { None };
    if let Some(line) = failure {
        for _ in 0..60 { eprintln!("{line} https://googlevideo.com/a?sig=secret &pot=secret cookie=secret token=secret C:/Users/Alice/private.mp4"); }
        std::process::exit(1);
    }
    println!("clipes-file:{target}");
}

use std::{env, fs, io::{self, Write}, thread, time::Duration};
fn main() {
    let args: Vec<String> = env::args().collect();
    let i = args.iter().position(|a| a == "-o").unwrap();
    let end = args.iter().position(|a| a == "--").unwrap();
    let url = &args[end + 1];
    let target = args[i + 1].replace("%(id)s", "video123").replace("%(ext)s", "mp4");
    fs::write(&target, b"media").unwrap();
    println!("clipes-progress: 42.0%"); io::stdout().flush().unwrap();
    if url.ends_with("hang") { thread::sleep(Duration::from_secs(30)); }
    if url.ends_with("fail") { eprintln!("secret path must not escape"); std::process::exit(1); }
    println!("clipes-file:{target}");
}

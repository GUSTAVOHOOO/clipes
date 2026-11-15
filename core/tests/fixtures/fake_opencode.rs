use std::{env, fs, io::{self, Read}, process::Command, thread, time::Duration};
fn beat(name: &str) -> ! {
    let root = env::current_exe().unwrap().parent().unwrap().to_owned();
    let mut n = 0;
    loop { n += 1; fs::write(root.join(name), n.to_string()).unwrap(); thread::sleep(Duration::from_millis(25)); }
}
fn main() {
    let root = env::current_exe().unwrap().parent().unwrap().to_owned();
    let mode = fs::read_to_string(root.join("mode")).unwrap_or_default();
    let args: Vec<String> = env::args().skip(1).collect();
    if args == ["--version"] { println!("opencode v{}", if mode == "unsupported" { "2.2.8" } else { "2.2.7" }); return; }
    if args == ["run", "--help"] { println!("--model, -m string
--agent string
--format choice
--standalone
--archived
--title string"); return; }
    if args == ["child"] { beat("child-beat"); }
    let mut input = String::new(); io::stdin().read_to_string(&mut input).unwrap();
    fs::write(root.join("prompt"), input).unwrap();
    fs::write(root.join("args"), args.join("\n")).unwrap();
    fs::write(root.join("cwd"), env::current_dir().unwrap().to_str().unwrap()).unwrap();
    fs::write(root.join("env"), env::vars().map(|(k,v)| format!("{k}={v}")).collect::<Vec<_>>().join("\n")).unwrap();
    if mode == "slow" {
        Command::new(env::current_exe().unwrap()).arg("child").spawn().unwrap();
        beat("beat");
    }
    if mode == "free-limit" || mode == "free-limit-no-delay" {
        let delay = if mode == "free-limit" { ",\"retryAfterMs\":79180001" } else { "" };
        println!("{{\"type\":\"error\",\"error\":{{\"type\":\"provider.free-limit\",\"message\":\"secret /personal/path\"{delay}}}}}");
        std::process::exit(1);
    }
    if mode == "tool" { println!("{{\"type\":\"tool_use\",\"part\":{{}}}}"); return; }
    if mode == "error" { println!("{{\"type\":\"error\",\"error\":{{\"message\":\"secret /personal/path\"}}}}"); return; }
    let version = if mode == "invalid" { 2 } else { 1 };
    println!("{{\"type\":\"step_start\",\"part\":{{}}}}");
    println!("{{\"type\":\"text\",\"part\":{{\"text\":\"{{\\\"schemaVersion\\\":{version}}}\"}}}}");
    let reason = if mode == "truncated" { "length" } else { "stop" };
    println!("{{\"type\":\"step_finish\",\"part\":{{\"reason\":\"{reason}\"}}}}");
}

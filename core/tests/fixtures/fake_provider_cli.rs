use std::{env, fs, io::{self, Read}};
fn main() {
    let args: Vec<String> = env::args().skip(1).collect();
    if args == ["--help"] {
        if env::var_os("FAKE_UNSUPPORTED").is_none() { println!("--tools <tools...>"); }
        return;
    }
    let mut prompt = String::new(); io::stdin().read_to_string(&mut prompt).unwrap();
    let mut data = args.join("\n"); data.push_str("\n---\n"); data.push_str(&prompt);
    data.push_str("\n---cwd---\n"); data.push_str(&env::current_dir().unwrap().to_string_lossy());
    fs::write(env::var("FAKE_LOG").unwrap(), data).unwrap();
    let version = if env::var_os("FAKE_INVALID").is_some() { 2 } else { 1 };
    if env::args().next().unwrap().contains("claude") { println!("{{\"structured_output\":{{\"schemaVersion\":{version}}}}}"); }
    else { println!("{{\"schemaVersion\":{version}}}"); }
}

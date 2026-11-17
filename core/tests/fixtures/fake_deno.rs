// Componente deno falso (#203): só responde `--version` como o deno real.
fn main() {
    if std::env::args().nth(1).as_deref() == Some("--version") {
        println!("deno 2.9.8 (stable, release, fake)");
    }
}

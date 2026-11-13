fn main() -> Result<(), Box<dyn std::error::Error>> {
    let result = clipes_core::dispatch("app.version", serde_json::json!({}), &mut |event| {
        println!("event: {}", serde_json::to_string(&event).unwrap());
    })
    .map_err(|error| std::io::Error::other(error.message))?;
    println!("result: {result}");
    Ok(())
}

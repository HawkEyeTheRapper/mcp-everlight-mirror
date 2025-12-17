import json
import os

def create_html_for_record(record, dist_dir):
    """Creates an HTML file for a single record."""
    slug = record.get("slug", "").replace("/", "_")
    title = record.get("title", "No Title")
    summary = record.get("summary", "No Summary")
    
    html_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>{title}</title>
</head>
<body>
    <h1>{title}</h1>
    <p>{summary}</p>
</body>
</html>
"""
    
    with open(os.path.join(dist_dir, f"{slug}.html"), "w") as f:
        f.write(html_content)

def create_index_page(records, dist_dir):
    """Creates an index.html page with links to all records."""
    links = ""
    for record in records:
        slug = record.get("slug", "").replace("/", "_")
        title = record.get("title", "No Title")
        links += f'<li><a href="{slug}.html">{title}</a></li>'
        
    index_content = f"""
<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="UTF-8">
    <meta name="viewport" content="width=device-width, initial-scale=1.0">
    <title>Everlight Mirror</title>
</head>
<body>
    <h1>Everlight Mirror</h1>
    <ul>
        {links}
    </ul>
</body>
</html>
"""
    
    with open(os.path.join(dist_dir, "index.html"), "w") as f:
        f.write(index_content)

def main():
    """Main function to build the site."""
    dist_dir = "dist"
    if not os.path.exists(dist_dir):
        os.makedirs(dist_dir)
        
    with open("data/data_records.json", "r") as f:
        records = json.load(f)
        
    for record in records:
        create_html_for_record(record, dist_dir)
        
    create_index_page(records, dist_dir)

if __name__ == "__main__":
    main()

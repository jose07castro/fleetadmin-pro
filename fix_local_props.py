import os

path = os.path.join(os.path.dirname(__file__), 'android', 'local.properties')
# Gradle local.properties format requires forward-slash OR escaped backslash
# Using forward slashes is the safest and most compatible approach
content = 'sdk.dir=C:/Users/Jose/AppData/Local/Android/Sdk\n'
with open(path, 'w', encoding='utf-8') as f:
    f.write(content)

print(f"Written to: {path}")
print(f"Content: {repr(content)}")

import http.server
import socketserver
import threading
import subprocess
import time

PORT = 8004
Handler = http.server.SimpleHTTPRequestHandler
httpd = socketserver.TCPServer(("", PORT), Handler)

thread = threading.Thread(target=httpd.serve_forever)
thread.daemon = True
thread.start()

print("Server started at localhost:8004")

apple_script = """
tell application "Safari"
    activate
    open location "http://localhost:8004/index.html"
    delay 3
    do JavaScript "document.getElementById('start-game-btn').click();" in document 1
    delay 1
    do JavaScript "document.querySelector('.hexagon').dispatchEvent(new Event('click'));" in document 1
    delay 1
    -- just return if it worked
    return "OK"
end tell
"""
try:
    # If Developer mode is enabled on my Safari (wait, it failed before, I'll use the temp script in HTML again)
    pass
except Exception as e:
    pass

httpd.shutdown()

import http.server
import socketserver
import os
import sys

import subprocess
import json

PORT = 8080

class NoCacheHTTPRequestHandler(http.server.SimpleHTTPRequestHandler):
    def end_headers(self):
        # Force browser to always fetch fresh updated JS/CSS/HTML files on refresh
        self.send_header('Cache-Control', 'no-store, no-cache, must-revalidate, max-age=0')
        self.send_header('Pragma', 'no-cache')
        self.send_header('Expires', '0')
        super().end_headers()

    def do_GET(self):
        if self.path == '/api/update':
            try:
                res = subprocess.run(['git', 'pull', 'origin', 'main'], capture_output=True, text=True, timeout=30)
                output = res.stdout or res.stderr or 'Updated'
                is_up_to_date = 'Already up to date' in output or 'Already up-to-date' in output
                self.send_response(200)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({
                    'success': True,
                    'output': output.strip(),
                    'upToDate': is_up_to_date
                }).encode('utf-8'))
            except Exception as e:
                self.send_response(500)
                self.send_header('Content-Type', 'application/json; charset=utf-8')
                self.end_headers()
                self.wfile.write(json.dumps({'success': False, 'error': str(e)}).encode('utf-8'))
            return
        super().do_GET()

if __name__ == '__main__':
    web_dir = os.path.dirname(os.path.abspath(__file__))
    os.chdir(web_dir)
    print(f"FarmNotes Web Server running at http://localhost:{PORT} (No-Cache Mode)")
    
    socketserver.TCPServer.allow_reuse_address = True
    with socketserver.TCPServer(("", PORT), NoCacheHTTPRequestHandler) as httpd:
        try:
            httpd.serve_forever()
        except KeyboardInterrupt:
            print("\nServer stopped.")

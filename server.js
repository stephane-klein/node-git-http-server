#!/usr/bin/env node
import path from 'path';
import { existsSync } from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn, execSync } from 'child_process';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const PORT = 3334;
const GIT_PROJECT_ROOT = path.join(__dirname, 'git-server-volume');

['repos1', 'repos2', 'repos3'].forEach((repoName) => {
    const repoPath = path.join(GIT_PROJECT_ROOT, `${repoName}.git`);
    if (existsSync(repoPath)) {
        console.log(`"${repoName}" git bare repository already exists`);
    } else {
        console.log(`Create "${repoName}" git bare repository`);
        execSync(
            `
                mkdir -p "${repoPath}" && \\
                cd "${repoPath}" && \\
                git init --bare && \\
                git config http.receivepack true && \\
                git config http.uploadpack true
            `,
            { stdio: ['ignore', 'ignore', 'inherit'] }
        );
    }
});

function handleGitRequest(req, res) {
    const url = new URL(req.url, 'http://localhost');
    const pathname = url.pathname;
    const query = Object.fromEntries(url.searchParams);

    // Environment variables for git-http-backend
    const env = {
        ...process.env,
        GIT_PROJECT_ROOT: GIT_PROJECT_ROOT,
        GIT_HTTP_EXPORT_ALL: '1', // Allow all repositories to be accessed
        PATH_INFO: pathname.substring(4), // Remove '/git' prefix
        REQUEST_METHOD: req.method,
        QUERY_STRING: query ? new URLSearchParams(query).toString() : '',
        CONTENT_TYPE: req.headers['content-type'] || '',
        CONTENT_LENGTH: req.headers['content-length'] || '0',
        HTTP_USER_AGENT: req.headers['user-agent'] || '',
        HTTP_AUTHORIZATION: req.headers['authorization'] || '',
        REMOTE_ADDR: req.socket.remoteAddress || '',
        REMOTE_USER: '', // Set this if you have authentication
        SERVER_NAME: req.headers.host?.split(':')[0] || 'localhost',
        SERVER_PORT: req.headers.host?.split(':')[1] || PORT.toString(),
    };

    // Spawn git-http-backend process
    const gitBackend = spawn('git', ['http-backend'], {
        env,
        stdio: ['pipe', 'pipe', 'pipe']
    });

    // Handle errors
    gitBackend.on('error', (error) => {
        console.error('Git backend error:', error);
        res.statusCode = 500;
        res.end('Internal Server Error');
    });

    // Pipe request body to git-http-backend stdin
    req.pipe(gitBackend.stdin);

    // Handle git-http-backend output
    let responseHeaders = {};
    let headersParsed = false;
    let responseBuffer = Buffer.alloc(0);

    gitBackend.stdout.on('data', (chunk) => {
        if (!headersParsed) {
            responseBuffer = Buffer.concat([responseBuffer, chunk]);
            const headerEndIndex = responseBuffer.indexOf('\r\n\r\n');

            if (headerEndIndex !== -1) {
                // Parse headers
                const headerSection = responseBuffer.subarray(0, headerEndIndex).toString();
                const bodySection = responseBuffer.subarray(headerEndIndex + 4);

                const headers = headerSection.split('\r\n');
                headers.forEach(header => {
                    const [key, ...valueParts] = header.split(':');
                    if (key && valueParts.length > 0) {
                        const value = valueParts.join(':').trim();
                        if (key.toLowerCase() === 'status') {
                            const statusCode = parseInt(value.split(' ')[0]);
                            res.statusCode = statusCode;
                        } else {
                            responseHeaders[key] = value;
                        }
                    }
                });

                // Set response headers
                Object.entries(responseHeaders).forEach(([key, value]) => {
                    res.setHeader(key, value);
                });

                headersParsed = true;

                // Send body chunk if exists
                if (bodySection.length > 0) {
                    res.write(bodySection);
                }
            }
        } else {
            // Headers already parsed, write chunk directly
            res.write(chunk);
        }
    });

    gitBackend.stdout.on('end', () => {
        res.end();
    });

    gitBackend.stderr.on('data', (data) => {
        console.error('Git backend stderr:', data.toString());
    });
}

function requestHandler(req, res) {
    const { pathname } = new URL(req.url, 'http://localhost');

    // Check if request matches /git/.* pattern
    if (pathname.startsWith('/git/')) {
        const gitPath = pathname.substring(5); // Remove '/git/' prefix

        // Basic security check - prevent directory traversal
        if (gitPath.includes('..') || gitPath.includes('//')) {
            res.statusCode = 400;
            res.end('Bad Request');
            return;
        }

        handleGitRequest(req, res);
        return;
    }

    // Handle non-git requests
    res.statusCode = 404;
    res.setHeader('Content-Type', 'text/plain');
    res.end('Not Found');
}

// Create and start server
const server = http.createServer(requestHandler);

server.listen(PORT, () => {
    console.log(`Server running on http://localhost:${PORT}`);
    console.log(`Git repositories served from: ${GIT_PROJECT_ROOT}`);
});

// Graceful shutdown
process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        process.exit(0);
    });
});

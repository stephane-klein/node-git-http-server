#!/usr/bin/env node
import path from 'path';
import { existsSync, writeFileSync } from 'fs';
import { fileURLToPath } from 'url';
import http from 'http';
import { spawn, execSync } from 'child_process';
import express from 'express';
import dedent from 'string-dedent';

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
                cd "${repoPath}" && \
                git init --bare && \\
                git config http.receivepack true && \\
                git config http.uploadpack true
            `,
            { stdio: ['ignore', 'ignore', 'inherit'] }
        );

    }
    writeFileSync(
        path.join(repoPath, 'hooks/post-receive'),
        dedent`
            #!/bin/bash

            # Obtenir les informations du push
            while read oldrev newrev refname; do
                branch=$(git rev-parse --symbolic --abbrev-ref $refname)

                curl -X POST \\
                  -H "Content-Type: application/json" \\
                  -d "{
                    \\"oldrev\\": \\"\${oldrev}\\",
                    \\"newrev\\": \\"\${newrev}\\",
                    \\"refname\\": \\"\${refname}\\",
                    \\"branch\\": \\"\${branch}\\",
                    \\"repository\\": \\"$(basename $(pwd))\\"
                  }" \\
                  "\${POST_RECIEVE_HOOK_URL}" >> /dev/null
            done
        `
    )
});

const app = express();
app.use(express.json());

app.all(
    /\/git\/.*/,
    (req, res) => {
        const gitPath = req.path.substring(5); // Remove '/git/' prefix

        // Basic security check - prevent directory traversal
        if (gitPath.includes('..') || gitPath.includes('//')) {
            return res.status(400).send('Bad Request');
        }

        const pathname = req.path;
        const query = req.query;

        // Environment variables for git-http-backend
        const env = {
            ...process.env,
            GIT_PROJECT_ROOT: GIT_PROJECT_ROOT,
            GIT_HTTP_EXPORT_ALL: '1',
            PATH_INFO: pathname.substring(4), // Remove '/git' prefix
            REQUEST_METHOD: req.method,
            QUERY_STRING: query ? new URLSearchParams(query).toString() : '',
            CONTENT_TYPE: req.get('content-type') || '',
            CONTENT_LENGTH: req.get('content-length') || '0',
            HTTP_USER_AGENT: req.get('user-agent') || '',
            HTTP_AUTHORIZATION: req.get('authorization') || '',
            REMOTE_ADDR: req.ip || '',
            REMOTE_USER: '',
            SERVER_NAME: req.hostname || 'localhost',
            SERVER_PORT: PORT.toString(),
            POST_RECIEVE_HOOK_URL: `http://localhost:${PORT}/post_recieve_hook_url/`
        };

        // Spawn git-http-backend process
        const gitBackend = spawn('git', ['http-backend'], {
            env,
            stdio: ['pipe', 'pipe', 'pipe']
        });

        // Handle errors
        gitBackend.on('error', (error) => {
            console.error('Git backend error:', error);
            res.status(500).send('Internal Server Error');
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
                                res.status(statusCode);
                            } else {
                                responseHeaders[key] = value;
                            }
                        }
                    });

                    // Set response headers
                    Object.entries(responseHeaders).forEach(([key, value]) => {
                        res.set(key, value);
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
);

app.post(
    '/post_recieve_hook_url/',
    (req, res) => {
        console.log('Received JSON:', req.body);
        res.json({ success: true, received: req.body });
    }
)

app.listen(
    PORT,
    () => {
        console.log(`Server running on http://localhost:${PORT}`);
        console.log(`Git repositories served from: ${GIT_PROJECT_ROOT}`);
    }
);

process.on('SIGINT', () => {
    console.log('\nShutting down server...');
    server.close(() => {
        process.exit(0);
    });
});

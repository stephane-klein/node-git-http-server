# Native Node.js Git HTTP Server with git-http-backend 

A Git HTTP server using native Node.js modules, [Express](https://expressjs.com/) and [git-http-backend](https://git-scm.com/docs/git-http-backend).

More information in french, see: https://notes.sklein.xyz/Projet%2032/

```sh
$ mise install
$ pnpm install
$ ./server.js
Create "repos1" git bare repository
Create "repos2" git bare repository
Create "repos3" git bare repository
Server running on http://localhost:3334
Git repositories served from: .../poc-node-git-server/git-server-volume
```

Execute this script to create a dummy git working copy:

```sh
$ ./scripts/create-dummy-git-working-copy.sh
Initialized empty Git repository in .../poc-node-git-server/dummy-git-working-copy/.git/
[main (root-commit) 2bf6b5a] First import
 1 file changed, 1 insertion(+)
 create mode 100644 README.md
```

Now, you can go in this dummy working copy and push the content to Git server on `http://localhost:3334/git/repos1.git`:

```sh
$ cd dummy-git-working-copy
$ git push origin main
Enumerating objects: 3, done.
Counting objects: 100% (3/3), done.
Writing objects: 100% (3/3), 221 bytes | 221.00 KiB/s, done.
Total 3 (delta 0), reused 0 (delta 0), pack-reused 0 (from 0)
To http://localhost:3334/git/repos1.git
 * [new branch]      main -> main
```

Success :)

You can go to `./git-server/volume/repos1.git/` to verify that the content is really present in the bare Git repository:

```
$ cd ./git-server-volume/repos1.git/
$ git log
commit 2bf6b5a09700f5b5706a76912871fa948fc6c91e (HEAD -> main)
Author: stephane-klein <contact@stephane-klein.info>
Date:   Sun Aug 24 11:07:11 2025 +0200

    First import
```

After each `git push`, an event with a few parameters is sent to the server's `/post_recieve_hook_url/` endpoint.  
You can see this event pass through in the *stdout* of `server.js`:

```
...
Received JSON: {
  oldrev: 'aa9c439c932854be6c217614ee35fc4f31ee9c68',
  newrev: '0e797f33342f49962a084db1c945ed0f87325543',
  refname: 'refs/heads/main',
  branch: 'main',
  repository: 'repos1.git'
}
```

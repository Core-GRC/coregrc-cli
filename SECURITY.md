# Security

## Reporting a vulnerability

Please don't report security problems in public GitHub issues. Email support@core-grc.com with "Security" in the subject, and include:

- what you found and where (file, command, or URL)
- steps to reproduce it
- the CLI version (`coregrc --version`) and your operating system

We'll acknowledge your report and keep you updated while we fix it.

## Supported versions

Security fixes go into the latest published version of `coregrc`. Update with:

```bash
npm install -g coregrc@latest
```

## Your credentials

`coregrc login` stores your sign-in in `~/.config/coregrc/credentials.json` (or the path in `COREGRC_CREDENTIALS`), readable only by you. Don't share or commit that file. `coregrc logout` revokes the sign-in and deletes it.

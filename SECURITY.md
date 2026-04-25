# Security Policy

## Supported Versions

vSender is a Chrome Extension built on Manifest V3. We provide security updates for the current major version.

| Version | Supported          |
| ------- | ------------------ |
| v1.1.x  | :white_check_mark: |
| < v1.1  | :x:                |

## Reporting a Vulnerability

If you discover a security vulnerability within this project, please **do not open a public issue**. Instead, please report it privately:

- **Email**: [security@vyakritisoft.com](mailto:security@vyakritisoft.com)
- **Response Time**: We aim to acknowledge reports within 48 hours and provide a resolution or status update within 7 days.

## Data Privacy & Security

### Local Execution
vSender operates entirely within your browser. 
- All message processing, queuing, and contact parsing happen **locally** on your machine.
- No contact data or message content is ever transmitted to or stored on our servers.

### Private Key Management
> [!IMPORTANT]
> This project uses digital signatures for extension identification. **Private keys (`.pem` files) must never be committed to this repository.** 
> If you are contributing or cloning this repo, ensure your environment specifically ignores `.pem` files to prevent unauthorized extension impersonation.

### Official Distribution
We strongly recommend only using the extension loaded from the source in this repository or downloaded from the official Chrome Web Store. Avoid manually installing `.crx` files from untrusted sources.

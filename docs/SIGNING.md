# Code signing

The Windows installer in each release is signed so a user can tell that the file they downloaded is
the file this project built, and that it has not been altered since.

## What the signature means, and what it does not

The signature is produced with a **self-signed** certificate — one this project generated for itself
(`.signing/logvex-codesign.crt`). That is enough to:

- prove the installer has not been modified after signing (any change invalidates the signature);
- show a publisher name (**Logvex**) and a signing timestamp in the Windows file properties.

It is **not** enough to suppress the Windows SmartScreen warning, because the certificate was not
issued by a public Certificate Authority (CA). A CA-issued certificate requires a paid identity
check and is the only way to remove that warning. Until the project has one, tell users to verify the
`SHA256SUMS.txt` checksum — that is the stronger guarantee anyway.

| Property | Value |
| --- | --- |
| Subject | `CN=Logvex Code Signing, OU=Release Engineering, O=Logvex, C=SG` |
| Issuer | self-signed (same as subject) |
| Key usage | Digital Signature |
| Extended key usage | Code Signing |
| Validity | 10 years from 2026-11-11 |
| SHA-256 fingerprint | `A2:86:19:E1:14:24:42:5C:25:1F:B1:D9:AD:63:3A:66:36:D9:A8:B9:EC:54:A7:F7:4D:2A:E8:3C:DE:1D:F0:D2` |
| Serial | `1EBA6BB945377DBE2B6EFAA9B0D2C53B55531749` |

The public certificate (`.signing/logvex-codesign.crt`) is committed so anyone can inspect it. The
**private key is not in the repository** — it is gitignored (`.signing/*.key`). Losing the key means
a new certificate has to be generated and every future build signed with the new one; it does not
invalidate already-published releases.

## Regenerating the certificate

```bash
openssl req -x509 -newkey rsa:4096 -keyout .signing/logvex-codesign.key \
  -out .signing/logvex-codesign.crt -days 3650 -nodes \
  -subj "/C=SG/O=Logvex/OU=Release Engineering/CN=Logvex Code Signing" \
  -addext "keyUsage=critical,digitalSignature" \
  -addext "extendedKeyUsage=codeSigning" \
  -addext "basicConstraints=critical,CA:FALSE"
```

The two `-addext` lines matter: without `extendedKeyUsage=codeSigning`, Windows rejects the
signature for Authenticode purposes even though it verifies cryptographically.

## Signing a build

```bash
# needs osslsigncode (apt-get install osslsigncode)
scripts/sign-windows.sh "host/release/Logvex Fleet Manager Setup 6.0.0.exe" \
  /tmp/Logvex-Fleet-Manager-v6.0.0-windows-x64-setup.exe
```

The script embeds the certificate, signs with SHA-256, and requests a **timestamp** from DigiCert's
free RFC 3161 service. The timestamp is what keeps the signature valid after the certificate expires,
so do not drop it.

## Verifying a signed installer

```bash
osslsigncode verify -in Logvex-Fleet-Manager-v6.0.0-windows-x64-setup.exe
```

Look for `Calculated message digest` equal to `Current message digest`, a `Signer` subject of
`Logvex Code Signing`, and a `Timestamp time`. On Windows, the same information is on the file's
**Properties → Digital Signatures** tab.

## Trusting the certificate locally (optional)

To stop the SmartScreen warning on your own machine you can import the public certificate into the
Trusted Root and Trusted Publishers stores:

```powershell
Import-Certificate -FilePath .signing\logvex-codesign.crt -CertStoreLocation Cert:\CurrentUser\TrustedPublisher
```

Do this only if you obtained the certificate from this repository and have verified it. Anyone can
generate a certificate that claims to be Logvex; trusting one blindly defeats the purpose.

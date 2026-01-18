#!/bin/bash
# Second Brain Agent - mTLS Truststore Setup
#
# Downloads DigiCert root and intermediate CA certificates required for
# Slack mTLS authentication. Certificates are fetched directly from DigiCert.
#
# Usage: ./scripts/setup-truststore.sh
#
# Output: certs/digicert-root-ca.pem
#
# Reference: https://api.slack.com/authentication/verifying-requests-from-slack#using-mutual-tls

set -e

CERTS_DIR="certs"
OUTPUT_FILE="$CERTS_DIR/digicert-root-ca.pem"

echo "=========================================="
echo "Second Brain - mTLS Truststore Setup"
echo "=========================================="
echo ""
echo "Downloading DigiCert CA certificates..."
echo ""

mkdir -p "$CERTS_DIR"

# Clear existing file
> "$OUTPUT_FILE"

# DigiCert Root CA certificates
# Source: https://www.digicert.com/kb/digicert-root-certificates.htm
ROOTS=(
  "https://cacerts.digicert.com/DigiCertGlobalRootCA.crt.pem"
  "https://cacerts.digicert.com/DigiCertGlobalRootG2.crt.pem"
  "https://cacerts.digicert.com/DigiCertGlobalRootG3.crt.pem"
  "https://cacerts.digicert.com/DigiCertHighAssuranceEVRootCA.crt.pem"
  "https://cacerts.digicert.com/DigiCertTrustedRootG4.crt.pem"
)

# DigiCert Intermediate CA certificates
# These are required because Slack's client cert is signed by an intermediate CA
INTERMEDIATES=(
  "https://cacerts.digicert.com/DigiCertTLSRSASHA2562020CA1.crt.pem"
  "https://cacerts.digicert.com/DigiCertGlobalG2TLSRSASHA2562020CA1.crt.pem"
  "https://cacerts.digicert.com/DigiCertSHA2ExtendedValidationServerCA.crt.pem"
)

echo "Downloading root CAs..."
for url in "${ROOTS[@]}"; do
  name=$(basename "$url" .crt.pem)
  echo "  - $name"
  if curl -sf "$url" >> "$OUTPUT_FILE"; then
    echo "" >> "$OUTPUT_FILE"  # Add newline between certs
  else
    echo "    WARNING: Failed to download $name"
  fi
done

echo ""
echo "Downloading intermediate CAs..."
for url in "${INTERMEDIATES[@]}"; do
  name=$(basename "$url" .crt.pem)
  echo "  - $name"
  if curl -sf "$url" >> "$OUTPUT_FILE"; then
    echo "" >> "$OUTPUT_FILE"
  else
    echo "    WARNING: Failed to download $name"
  fi
done

# Verify the bundle
echo ""
echo "Verifying certificate bundle..."
CERT_COUNT=$(grep -c "BEGIN CERTIFICATE" "$OUTPUT_FILE" || echo "0")

if [ "$CERT_COUNT" -eq 0 ]; then
  echo "ERROR: No certificates downloaded!"
  exit 1
fi

echo "  - $CERT_COUNT certificates in bundle"

# List certificate subjects
echo ""
echo "Certificates included:"
openssl storeutl -noout -text -certs "$OUTPUT_FILE" 2>/dev/null | grep "Subject:" | sed 's/.*CN=/  - /' || \
  echo "  (install openssl to see certificate details)"

echo ""
echo "=========================================="
echo "Truststore created: $OUTPUT_FILE"
echo "=========================================="
echo ""
echo "Next steps:"
echo "  1. Review the certificates if desired"
echo "  2. Run: ./scripts/deploy.sh --mode mtls-hmac"
echo ""
echo "Note: This file is gitignored. Each developer must run this script."
echo ""

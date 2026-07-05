# AidLink — Humanitarian Aid Platform

> **DevCareer x Nomba Hackathon 2026 · Team Impact**

AidLink is a programmatic aid clearinghouse that ensures humanitarian donations actually reach the people who need them. Donors fund campaigns, verified beneficiaries receive aid, and delivery partners are paid automatically only after physical proof of delivery.

**Live API:** https://aidlink-jhur.onrender.com

---

## How It Works

```
Donor pays via Nomba → Webhook credits campaign → Target met → 
Fulfillment job created → Partner claims + delivers → 
Beneficiary shares 6-digit code → Code verified → Partner paid
```

---

## Tech Stack

| Layer | Technology |
|-------|-----------|
| Runtime | Node.js 24 + TypeScript |
| Framework | Express v5 |
| Database | PostgreSQL via Prisma v6 |
| Payments | Nomba Checkout + Bank Transfer API |
| KYC | Smile ID (NIN, Face Match, CAC) |
| AI | Google Gemini 2.5 Flash (invoice verification) |
| Storage | Cloudinary (invoice uploads) |
| Deployment | Render |

---

## Getting Started

### Prerequisites

- Node.js 18+
- PostgreSQL database
- Nomba API credentials
- Google AI API key
- Cloudinary account

### Installation

```bash
git clone https://github.com/SpectraCode-Tech/Aidlink-Backend
cd Aidlink-Backend
npm install
```

### Environment Variables

Copy `.env.example` and fill in your values:

```bash
cp .env.example .env
```

Required variables:

```dotenv
DATABASE_URL=postgresql://...
JWT_SECRET=your-64-byte-hex-secret
NOMBA_BASE_URL=https://api.nomba.com
NOMBA_ACCOUNT_ID=your-account-id
NOMBA_SUB_ACCOUNT_ID=your-sub-account-id
NOMBA_CLIENT_ID=your-client-id
NOMBA_CLIENT_SECRET=your-private-key
NOMBA_SIGNING_SECRET=your-webhook-signing-key
NOMBA_CALLBACK_URL=https://yourapp.com/payment/success
CLOUDINARY_CLOUD_NAME=your-cloud-name
CLOUDINARY_API_KEY=your-api-key
CLOUDINARY_API_SECRET=your-api-secret
GOOGLE_GENERATIVE_AI_API_KEY=your-gemini-key
SMILE_ID_PARTNER_ID=your-partner-id
SMILE_ID_API_KEY=your-api-key
SMILE_ID_BASE_URL=https://sandbox.smileidentity.com/v1
NODE_ENV=development
PORT=3000
CORS_ORIGIN=http://localhost:5173
```

### Database Setup

```bash
npx prisma migrate deploy
npx prisma generate
```

### Run Locally

```bash
npm run dev
```

Server starts at `http://localhost:3000`

### Build for Production

```bash
npm run build
npm start
```

---

## API Endpoints

See `AidLink_API_Reference.pdf` for full documentation with request/response examples.

### Quick Reference

| Method | Endpoint | Description | Auth |
|--------|----------|-------------|------|
| POST | /auth/register | Register user | — |
| POST | /auth/login | Login + get token | — |
| GET | /auth/me | Current user profile | Any |
| POST | /verification/verify-nin | Verify NIN | BENEFICIARY |
| POST | /verification/verify-face | Biometric face match | BENEFICIARY |
| POST | /verification/verify-cac | Verify CAC registration | PARTNER |
| POST | /requests | Create aid request (AI scored) | BENEFICIARY |
| GET | /requests | List all requests | — |
| GET | /requests/:id | Single request details | — |
| POST | /payments/donate | Initialize Nomba checkout | DONOR |
| GET | /payments/cloudinary-signature | Signed upload token | Any |
| POST | /webhooks/payments/nomba-webhook | Nomba payment events | Nomba only |
| GET | /logistics/feed | Available delivery jobs | PARTNER |
| PATCH | /logistics/requests/:id/claim | Claim a job | PARTNER |
| PATCH | /logistics/requests/:id/status | Update tracking status | PARTNER |
| POST | /logistics/requests/:id/complete | Confirm delivery + payout | PARTNER |
| GET | /admin/metrics | System metrics | ADMIN |
| GET | /admin/audit-failures | Denied security pass log | ADMIN |
| POST | /admin/requests/:id/override | Force complete fulfillment | ADMIN |
| POST | /security/passes/generate | Generate access pass | Any |
| POST | /security/passes/verify | Verify access pass | Any |
| GET | /health | Server health check | — |

---

## Key Features

**AI Invoice Verification**
Every aid request is analyzed by Gemini 2.5 Flash. The model reads the invoice image and assigns a trust score (0–100). Score ≥ 80 = APPROVED, ≥ 60 = PARTIAL_FUNDING_ALLOWED, below = REJECTED.

**Nomba Payment Integration**
Donors pay via Nomba's hosted checkout. The server receives a webhook on payment confirmation, credits the campaign, and automatically creates a fulfillment dispatch when the funding target is reached.

**KYC Verification**
Beneficiaries verify their NIN (via Smile ID NIMC lookup) and face biometrics before creating requests. Partners verify CAC business registration before claiming jobs. All checks are sandbox-mocked and ready to activate with real credentials.

**6-Digit Delivery Handshake**
A cryptographically secure 6-character code is generated per fulfillment. The beneficiary shares it with the delivery partner at the point of handover. Only on a successful code match is the Nomba bank transfer triggered to the partner's NUBAN account.

**Security Pass System**
Physical access control for distribution points. Time-limited, use-counted tokens with QR payloads. Denials are logged for admin audit.

---

## Project Structure

```
src/
  controllers/
    auth.controller.ts
    request.controller.ts
    payments.controller.ts
    webhook.controller.ts
    logistics.controller.ts
    admin.controller.ts
    security.controller.ts
    verification.controller.ts
  middleware/
    auth.ts           # JWT + Prisma client
    validate.ts       # Zod validation middleware
    rbac.middleware.ts
  routes/
    auth.routes.ts
    request.routes.ts
    payment.routes.ts
    webhook.routes.ts
    logistics.routes.ts
    admin.routes.ts
    security.routes.ts
    verification.routes.ts
  helpers/
    nomba-transfer.ts # Shared Nomba bank transfer helper
  app.ts
  server.ts
prisma/
  schema.prisma
```

---

## Testing

Import the Postman collection from `AidLink.postman_collection.json` in the repo root.

Set environment variable `BASE_URL` to:
- Local: `http://localhost:3000`
- Production: `https://aidlink-jhur.onrender.com`

Run the full flow: register → KYC → create request → donate → webhook → logistics → complete delivery.

---

## Team

**Team Impact** — DevCareer x Nomba Hackathon 2026

---

## License

MIT

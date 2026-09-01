# Finance Automation - Invoice & TDS Management System

A Node.js/Express application for automating invoice processing with AI-powered extraction, vendor management, and GST/TDS calculations following Indian tax regulations.

---

## 📋 Table of Contents

- [Project Overview](#project-overview)
- [Technology Stack](#technology-stack)
- [Project Structure](#project-structure)
- [Installation & Setup](#installation--setup)
- [Environment Variables](#environment-variables)
- [Running the Application](#running-the-application)
- [API Endpoints](#api-endpoints)
- [Classes & Services Documentation](#classes--services-documentation)
- [Database Schema](#database-schema)
- [Features](#features)

---

## 🎯 Project Overview

This system automates the entire invoice lifecycle:

1. **Invoice Upload** → AI extracts data from PDF/image invoices
2. **Vendor Matching** → Auto-matches or creates vendor records by GSTIN
3. **TDS Calculation** → Calculates Tax Deducted at Source based on Indian tax sections
4. **Approval Workflow** → Finance team reviews and approves invoices
5. **Ledger Management** → Updates cumulative vendor TDS records by financial year

**Key Features:**
- 🤖 AI-powered invoice data extraction (Groq LLaMA)
- 💾 Supabase PostgreSQL database
- 🏢 Automatic vendor matching & creation
- 💰 Intelligent TDS calculation with threshold logic
- 📊 Financial year tracking (Indian FY: April-March)
- 🔒 CORS-protected API endpoints

---

## 🛠️ Technology Stack

| Component | Technology |
|-----------|-----------|
| **Runtime** | Node.js (ES Modules) |
| **Framework** | Express.js v4.21.1 |
| **Database** | Supabase (PostgreSQL) |
| **AI/ML** | Groq API (LLaMA 3.3 70B) |
| **PDF Processing** | pdfjs-dist v5.7.284 |
| **File Upload** | Multer v1.4.5 |
| **CORS** | cors v2.8.5 |
| **Environment** | dotenv v16.4.5 |
| **Dev Tool** | nodemon v3.1.7 |

---

## 📁 Project Structure

```
finance-automation/
├── package.json                    # Dependencies & scripts
├── src/
│   ├── index.js                    # Express app entry point
│   ├── config/
│   │   └── supabase.js            # Database initialization
│   ├── routes/
│   │   ├── invoices.js            # Invoice endpoints
│   │   └── vendors.js             # Vendor endpoints
│   └── services/
│       ├── geminiService.js       # AI extraction service
│       └── vendorServices.js      # Vendor & TDS logic
```

---

## 🚀 Installation & Setup

### Prerequisites
- Node.js v16+ & npm
- Supabase account with PostgreSQL database
- Groq API key
- Environment credentials

### Step 1: Clone & Install Dependencies

```bash
cd /Users/vihaan/Documents/AIForFinance/Code/finance-automation
npm install
```

### Step 2: Create `.env` File

```bash
cp .env.example .env  # or create manually
```

### Step 3: Configure Environment Variables

See [Environment Variables](#environment-variables) section below.

### Step 4: Run Database Migrations (if applicable)

Ensure your Supabase database has the required tables (see [Database Schema](#database-schema)).

---

## 🔐 Environment Variables

Create a `.env` file in the project root:

```env
# Server
PORT=3000

# Supabase Database
SUPABASE_URL=https://your-project.supabase.co
SUPABASE_PUBLISHABLE_KEY=your_publishable_key
SUPABASE_SERVICE_KEY=your_service_key

# Groq AI API
GROQ_API_KEY=your_groq_api_key
```

**Environment Details:**

| Variable | Description | Example |
|----------|-------------|---------|
| `PORT` | Express server port | `3000` |
| `SUPABASE_URL` | Supabase project URL | `https://abc123.supabase.co` |
| `SUPABASE_PUBLISHABLE_KEY` | Public API key | `eyJhbGc...` |
| `SUPABASE_SERVICE_KEY` | Service role key (admin) | `eyJhbGc...` |
| `GROQ_API_KEY` | Groq API authentication token | `gsk_...` |

---

## ▶️ Running the Application

### Development Mode (with auto-reload)

```bash
npm run dev
```

Watches for file changes and restarts automatically.

### Production Mode

```bash
npm start
```

### Verify Server is Running

```bash
curl http://localhost:3000/health
# Response: {"status":"ok"}
```

---

## 📡 API Endpoints

### Invoice Routes (`/api`)

#### 1. **POST `/extract-invoice`** - Upload & Extract Invoice
**Purpose:** Upload invoice PDF/image and extract data via AI

**Request:**
```bash
curl -X POST http://localhost:3000/api/extract-invoice \
  -F "invoice=@invoice.pdf" \
  -F "source=manual"
```

**Body (form-data):**
- `invoice` (file, required): PDF/JPG/PNG file (max 20MB)
- `source` (string, optional): Source identifier (default: "manual")

**Response (201):**
```json
{
  "invoice": {
    "id": 123,
    "vendor_id": 45,
    "vendor_name": "ABC Corp",
    "vendor_gstin": "27AABCU9603R1Z0",
    "amount": 50000,
    "taxable_amount": 42373,
    "cgst": 3814,
    "sgst": 3814,
    "igst": null,
    "gst_rate": 18,
    "invoice_date": "2024-08-15",
    "invoice_number": "INV-2024-001",
    "status": "pending",
    "tds_applicable": false,
    "tds_rate": null,
    "tds_amount": null,
    "net_payable": 50000,
    "financial_year": "2024-25",
    "confidence_score": 0.95
  },
  "vendor": {
    "id": 45,
    "company_name": "ABC Corp",
    "gstin": "27AABCU9603R1Z0",
    "tds_exempt": false
  },
  "vendorIsNew": false
}
```

---

#### 2. **PATCH `/invoices/:id/approve`** - Approve Invoice & Calculate TDS
**Purpose:** Approve invoice and calculate TDS deduction

**Request:**
```bash
curl -X PATCH http://localhost:3000/api/invoices/123/approve \
  -H "Content-Type: application/json" \
  -d '{
    "tds_section_id": 7,
    "reviewed_by": "finance@company.com"
  }'
```

**Body (JSON):**
- `tds_section_id` (number, optional): TDS section ID for calculation
- `reviewed_by` (string, optional): Approver email/name

**Response (200):**
```json
{
  "id": 123,
  "status": "approved",
  "tds_applicable": true,
  "tds_rate": 10,
  "tds_amount": 5000,
  "net_payable": 45000,
  "reviewed_at": "2024-08-20T10:30:00Z",
  "reviewed_by": "finance@company.com",
  "tdsResult": {
    "tdsApplicable": true,
    "tdsRate": 10,
    "tdsAmount": 5000,
    "netPayable": 45000
  }
}
```

---

#### 3. **PATCH `/invoices/:id/reject`** - Reject Invoice
**Purpose:** Reject invoice with reason

**Request:**
```bash
curl -X PATCH http://localhost:3000/api/invoices/123/reject \
  -H "Content-Type: application/json" \
  -d '{
    "reviewed_by": "finance@company.com",
    "reason": "Duplicate invoice detected"
  }'
```

**Body (JSON):**
- `reviewed_by` (string, optional): Reviewer identifier
- `reason` (string, optional): Rejection reason

**Response (200):**
```json
{
  "id": 123,
  "status": "rejected",
  "reviewed_at": "2024-08-20T10:35:00Z",
  "reviewed_by": "finance@company.com",
  "notes": "Duplicate invoice detected"
}
```

---

#### 4. **GET `/invoices`** - List Invoices
**Purpose:** Retrieve paginated invoice list with filters

**Request:**
```bash
curl "http://localhost:3000/api/invoices?status=pending&financial_year=2024-25&limit=20&offset=0"
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `status` | string | Filter: `pending`, `approved`, `rejected` |
| `vendor_id` | number | Filter by vendor ID |
| `financial_year` | string | Filter: `2024-25`, `2025-26` |
| `from` | string | Date range start (YYYY-MM-DD) |
| `to` | string | Date range end (YYYY-MM-DD) |
| `limit` | number | Pagination limit (default: 50) |
| `offset` | number | Pagination offset (default: 0) |

**Response (200):**
```json
{
  "invoices": [
    {
      "id": 123,
      "vendor_id": 45,
      "vendor_name": "ABC Corp",
      "amount": 50000,
      "status": "pending",
      "financial_year": "2024-25",
      "created_at": "2024-08-15T12:00:00Z"
    }
  ],
  "total": 150
}
```

---

#### 5. **GET `/invoices/:id`** - Get Invoice Details
**Purpose:** Fetch complete invoice with vendor & TDS section info

**Request:**
```bash
curl http://localhost:3000/api/invoices/123
```

**Response (200):**
```json
{
  "id": 123,
  "vendor_id": 45,
  "amount": 50000,
  "status": "approved",
  "vendors": {
    "id": 45,
    "company_name": "ABC Corp",
    "gstin": "27AABCU9603R1Z0",
    "pan": "AABCU9603R",
    "vendor_type": "company"
  },
  "tds_sections": {
    "id": 7,
    "section": "194C",
    "nature_of_payment": "Contractor Services",
    "rate_company": 10,
    "rate_individual": 10
  }
}
```

---

### Vendor Routes (`/api`)

#### 1. **GET `/vendors`** - List Vendors
**Purpose:** Retrieve vendor list with optional filters

**Request:**
```bash
curl "http://localhost:3000/api/vendors?search=ABC&vendor_type=company&is_msme=false"
```

**Query Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `search` | string | Search by company name, GSTIN, or PAN |
| `vendor_type` | string | Filter: `company`, `individual`, `firm`, etc. |
| `is_msme` | boolean | Filter MSME vendors |
| `tds_exempt` | boolean | Filter TDS-exempt vendors |

**Response (200):**
```json
{
  "vendors": [
    {
      "id": 45,
      "company_name": "ABC Corp",
      "gstin": "27AABCU9603R1Z0",
      "pan": "AABCU9603R",
      "vendor_type": "company",
      "is_msme": false,
      "tds_exempt": false
    }
  ],
  "total": 1
}
```

---

#### 2. **GET `/vendors/:id`** - Get Vendor Details
**Purpose:** Fetch vendor profile with TDS ledger & recent invoices

**Request:**
```bash
curl http://localhost:3000/api/vendors/45
```

**Response (200):**
```json
{
  "vendor": {
    "id": 45,
    "company_name": "ABC Corp",
    "gstin": "27AABCU9603R1Z0",
    "pan": "AABCU9603R",
    "email": "vendor@abc.com",
    "phone": "98765-43210",
    "address": "123 Business Park",
    "city": "Mumbai",
    "state": "Maharashtra",
    "pincode": "400001",
    "bank_account": "123456789012",
    "ifsc": "HDFC0000123",
    "bank_name": "HDFC Bank",
    "is_msme": false,
    "tds_exempt": false
  },
  "ledger": [
    {
      "id": 1,
      "vendor_id": 45,
      "financial_year": "2024-25",
      "tds_section_id": 7,
      "total_invoiced": 150000,
      "total_tds_deducted": 15000,
      "invoice_count": 3,
      "threshold_crossed": true,
      "tds_sections": {
        "section": "194C",
        "nature_of_payment": "Contractor Services"
      }
    }
  ],
  "recentInvoices": [
    {
      "id": 125,
      "invoice_number": "INV-2024-003",
      "invoice_date": "2024-08-25",
      "amount": 50000,
      "tds_amount": 5000,
      "net_payable": 45000,
      "status": "approved"
    }
  ]
}
```

---

#### 3. **POST `/vendors`** - Create Vendor
**Purpose:** Manually create a new vendor

**Request:**
```bash
curl -X POST http://localhost:3000/api/vendors \
  -H "Content-Type: application/json" \
  -d '{
    "company_name": "XYZ Services",
    "gstin": "27XYZXYZ0123456",
    "pan": "XYZXYZ0123",
    "vendor_type": "company",
    "email": "contact@xyz.com",
    "phone": "98765-43210",
    "address": "456 Tech Park",
    "city": "Bangalore",
    "state": "Karnataka",
    "pincode": "560001",
    "is_msme": false,
    "tds_exempt": false
  }'
```

**Body (JSON):**
- `company_name` (string, **required**): Vendor legal name
- `gstin` (string, optional): GSTIN (15 chars)
- `pan` (string, optional): PAN (10 chars)
- `vendor_type` (string): `company`, `individual`, `firm`, `trust`, `boi`
- `email` (string, optional)
- `phone` (string, optional)
- `address`, `city`, `state`, `pincode` (strings, optional)
- `bank_account`, `ifsc`, `bank_name` (strings, optional)
- `is_msme` (boolean, optional): MSME vendor flag
- `msme_registration_no` (string, optional)
- `tds_exempt` (boolean, optional): TDS exemption flag
- `tds_exempt_reason` (string, optional)
- `tds_exempt_upto` (string, optional): Date (YYYY-MM-DD)
- `default_tds_section_id` (number, optional)
- `notes` (string, optional)

**Response (201):**
```json
{
  "id": 100,
  "company_name": "XYZ Services",
  "gstin": "27XYZXYZ0123456",
  "pan": "XYZXYZ0123",
  "vendor_type": "company",
  "is_msme": false,
  "tds_exempt": false,
  "created_at": "2024-08-20T14:00:00Z"
}
```

---

#### 4. **PATCH `/vendors/:id`** - Update Vendor
**Purpose:** Update vendor profile

**Request:**
```bash
curl -X PATCH http://localhost:3000/api/vendors/45 \
  -H "Content-Type: application/json" \
  -d '{
    "email": "newemail@abc.com",
    "tds_exempt": true,
    "tds_exempt_reason": "Section 143(3)(a) - Government Agency"
  }'
```

**Body (JSON):** Any of the fields from Create Vendor

**Response (200):** Updated vendor object

---

#### 5. **GET `/vendors/:id/invoices`** - Get Vendor Invoices
**Purpose:** List all invoices for a vendor

**Request:**
```bash
curl "http://localhost:3000/api/vendors/45/invoices?financial_year=2024-25&status=approved"
```

**Query Parameters:**
- `financial_year` (string, optional): Filter by FY
- `status` (string, optional): Filter by status

**Response (200):**
```json
{
  "invoices": [
    {
      "id": 123,
      "invoice_number": "INV-2024-001",
      "amount": 50000,
      "tds_amount": 5000,
      "status": "approved",
      "financial_year": "2024-25"
    }
  ]
}
```

---

#### 6. **GET `/vendors/:id/tds`** - Get TDS Ledger
**Purpose:** Fetch TDS deduction history for a vendor

**Request:**
```bash
curl "http://localhost:3000/api/vendors/45/tds?financial_year=2024-25"
```

**Query Parameters:**
- `financial_year` (string, optional): Filter by FY

**Response (200):**
```json
{
  "ledger": [
    {
      "id": 1,
      "vendor_id": 45,
      "financial_year": "2024-25",
      "tds_section_id": 7,
      "total_invoiced": 150000,
      "total_tds_deducted": 15000,
      "invoice_count": 3,
      "threshold_crossed": true,
      "tds_sections": {
        "section": "194C",
        "sub_type": "Contractor",
        "nature_of_payment": "Contractor Services",
        "threshold_aggregate": 30000,
        "rate_individual": 10,
        "rate_company": 10
      }
    }
  ]
}
```

---

#### 7. **GET `/tds-sections`** - List TDS Sections
**Purpose:** Retrieve all active TDS sections for invoice approval

**Request:**
```bash
curl http://localhost:3000/api/tds-sections
```

**Response (200):**
```json
{
  "sections": [
    {
      "id": 7,
      "section": "194C",
      "sub_type": "Contractor",
      "nature_of_payment": "Contractor Services",
      "threshold_aggregate": 30000,
      "threshold_single": null,
      "rate_individual": 10,
      "rate_company": 10,
      "rate_no_pan": 20,
      "is_active": true
    },
    {
      "id": 15,
      "section": "194J",
      "sub_type": "Director Fees",
      "nature_of_payment": "Director Remuneration",
      "threshold_aggregate": 0,
      "rate_individual": 10,
      "rate_no_pan": 20,
      "is_active": true
    }
  ]
}
```

---

## 🔧 Classes & Services Documentation

### 1. **Supabase Config** (`src/config/supabase.js`)

**Purpose:** Initialize and export Supabase PostgreSQL client

**Exports:**
```javascript
export default supabase  // SupabaseClient instance
```

**Environment Dependencies:**
- `SUPABASE_URL`: Project URL
- `SUPABASE_PUBLISHABLE_KEY`: Public API key
- `SUPABASE_SERVICE_KEY`: Service role (admin) key

**Usage:**
```javascript
const { data, error } = await supabase
  .from("vendors")
  .select("*")
  .eq("id", 45);
```

---

### 2. **Gemini Service** (`src/services/geminiService.js`)

**Purpose:** AI-powered invoice data extraction using Groq LLaMA

#### **Function: `extractInvoice(fileBuffer, mimeType)`**

**Description:** Extracts structured invoice data from PDF/image files via AI

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `fileBuffer` | Buffer | File binary data from multer upload |
| `mimeType` | string | File MIME type: `application/pdf`, `image/jpeg`, `image/png` |

**Returns:**
```javascript
{
  vendor_name: string,           // Supplier company name
  vendor_gstin: string,          // 15-char GSTIN
  buyer_gstin: string,           // Buyer GSTIN
  amount: number,                // Total invoice amount (with tax)
  taxable_amount: number,        // Amount before GST
  cgst: number | null,           // Central GST amount
  sgst: number | null,           // State GST amount
  igst: number | null,           // Integrated GST amount
  gst_rate: number,              // GST percentage (e.g., 18)
  is_igst: boolean,              // True if IGST applied
  invoice_date: string,          // YYYY-MM-DD format
  invoice_number: string,        // Invoice ID/reference
  hsn_sac: string,               // HSN/SAC code
  description: string,           // Item/service description
  line_items: array,             // Detailed line items
  place_of_supply: string,       // State/destination
  confidence_score: number       // 0-1 extraction confidence
}
```

**Example Usage:**
```javascript
const extracted = await extractInvoice(buffer, "application/pdf");
console.log(`${extracted.vendor_name} | ₹${extracted.amount}`);
```

**AI Prompt Template:**
- Uses Groq LLaMA 3.3-70B model
- Extracts 16+ invoice fields
- Returns only JSON (no markdown)
- Temperature: 0 (deterministic)
- Max tokens: 1024

**Error Handling:**
- Throws if PDF extraction fails
- Throws if JSON parsing fails
- Throws if Groq API returns invalid response

---

### 3. **Vendor Services** (`src/services/vendorServices.js`)

**Purpose:** Vendor matching, TDS calculation, and ledger management

#### **Function: `getCurrentFinancialYear()`**

**Description:** Returns current Indian financial year (April-March)

**Returns:** String (e.g., `"2024-25"`)

**Logic:**
- January-March → Previous FY (e.g., Mar 2024 → "2023-24")
- April-December → Current FY (e.g., Aug 2024 → "2024-25")

---

#### **Function: `getFYFromDate(dateStr)`**

**Description:** Derives financial year from invoice date

**Parameters:**
- `dateStr` (string): Date in YYYY-MM-DD format

**Returns:** String (e.g., `"2024-25"`)

**Example:**
```javascript
getFYFromDate("2024-08-15") // Returns "2024-25"
getFYFromDate("2024-03-10") // Returns "2023-24"
```

---

#### **Function: `findOrCreateVendor(extracted)`**

**Description:** Auto-matches vendor by GSTIN or company name; creates new if not found

**Parameters:**
- `extracted` (object): Invoice data from `extractInvoice()`

**Returns:**
```javascript
{
  vendor: {
    id: number,
    company_name: string,
    gstin: string,
    pan: string,
    vendor_type: string,
    // ... other vendor fields
  },
  isNew: boolean  // true if newly created
}
```

**Matching Logic:**
1. **GSTIN Match (Priority 1):** Exact GSTIN lookup → most reliable
2. **Name Match (Priority 2):** Fuzzy match normalized company names (lowercase, remove punctuation)
3. **Create New (Priority 3):** If no match found, auto-create vendor with extracted data

**Vendor Type Derivation:** Based on GSTIN character 10:
- `P` → Individual/Proprietor
- `F` → Firm
- `B` → Body of Individuals
- `T` → Trust
- Other → Company

**Example:**
```javascript
const { vendor, isNew } = await findOrCreateVendor({
  vendor_name: "ABC Corp Ltd",
  vendor_gstin: "27AABCU9603R1Z0"
});
console.log(`${isNew ? "New" : "Existing"} vendor: ${vendor.company_name}`);
```

---

#### **Function: `calculateTDS(vendorId, invoiceAmount, sectionId, invoiceDate)`**

**Description:** Calculates TDS deduction based on Indian tax rules

**Parameters:**
| Parameter | Type | Description |
|-----------|------|-------------|
| `vendorId` | number | Vendor ID from database |
| `invoiceAmount` | number | Invoice total (₹) |
| `sectionId` | number | TDS section ID (194C, 194J, etc.) |
| `invoiceDate` | string | Date (YYYY-MM-DD) |

**Returns:**
```javascript
{
  tdsApplicable: boolean,     // Should TDS be deducted?
  tdsRate: number,            // TDS percentage (0, 10, 20)
  tdsAmount: number,          // TDS deduction amount (₹)
  netPayable: number,         // Amount after TDS
  financialYear: string,      // "2024-25"
  section: string             // "194C"
}
```

**TDS Calculation Logic:**

1. **Exemption Check:**
   - If vendor marked `tds_exempt` and exemption not expired → return no TDS

2. **Rate Determination:**
   - If vendor has no PAN → 20% (penalty rate)
   - If individual/firm → `rate_individual` from section
   - If company → `rate_company` from section

3. **Threshold Logic (Indian TDS Rule):**
   - If threshold = 0 → TDS applies on all invoices (194J director fees)
   - If cumulative < threshold → No TDS yet
   - If cumulative + new invoice ≥ threshold:
     - ✅ TDS applies on **entire cumulative amount** (not just excess)
     - Mark ledger as "threshold_crossed"
   - If already crossed in previous invoice → TDS on full current invoice

4. **Amount Calculation:**
   ```
   tdsBase = (if crossed) ? newCumulative : currentInvoice
   tdsAmount = floor((tdsBase × rate) / 100)
   netPayable = invoiceAmount - tdsAmount
   ```

**Example Scenario (Section 194C - ₹30,000 threshold):**
```javascript
// Invoice 1: ₹20,000
calculateTDS(vendor_id, 20000, section_194C, "2024-08-01")
// → TDS: ₹0 (cumulative ₹20K < ₹30K threshold)

// Invoice 2: ₹15,000 (total cumulative ₹35K)
calculateTDS(vendor_id, 15000, section_194C, "2024-09-01")
// → TDS: ₹3,500 on full ₹35K (since threshold crossed)
// → Already ₹0 deducted on Invoice 1, so deduct ₹3,500 now
```

---

#### **Function: `updateTDSLedger(vendorId, sectionId, invoiceAmount, tdsAmount, invoiceDate)`**

**Description:** Updates cumulative TDS records after invoice approval

**Parameters:**
- `vendorId` (number): Vendor ID
- `sectionId` (number): TDS section ID
- `invoiceAmount` (number): Invoice amount (₹)
- `tdsAmount` (number): TDS deducted (₹)
- `invoiceDate` (string): YYYY-MM-DD

**Ledger Record Updated:**
```javascript
{
  vendor_id: number,
  financial_year: string,        // "2024-25"
  tds_section_id: number,
  total_invoiced: number,        // Cumulative all invoices
  total_tds_deducted: number,    // Cumulative TDS
  invoice_count: number,         // Count of invoices
  threshold_crossed: boolean,    // Has threshold been crossed?
  updated_at: timestamp
}
```

**Logic:**
- If ledger row exists → Increment totals
- If new → Insert first row
- Set `threshold_crossed = true` if `total_invoiced >= threshold`

**Example:**
```javascript
await updateTDSLedger(
  45,              // vendor_id
  7,               // tds_section_id (194C)
  50000,           // invoiceAmount
  5000,            // tdsAmount
  "2024-08-15"
);
// Creates/updates vendor_tds_ledger row
```

---

### 4. **Invoice Routes** (`src/routes/invoices.js`)

**Endpoints:**
- `POST /extract-invoice` → Extract & auto-create invoice
- `PATCH /invoices/:id/approve` → Approve & calculate TDS
- `PATCH /invoices/:id/reject` → Reject invoice
- `GET /invoices` → List invoices with filters
- `GET /invoices/:id` → Fetch invoice details

(See [API Endpoints](#api-endpoints) section for full details)

---

### 5. **Vendor Routes** (`src/routes/vendors.js`)

**Endpoints:**
- `GET /vendors` → List vendors with search/filters
- `GET /vendors/:id` → Get vendor profile + ledger
- `POST /vendors` → Create vendor manually
- `PATCH /vendors/:id` → Update vendor
- `GET /vendors/:id/invoices` → Get vendor's invoices
- `GET /vendors/:id/tds` → Get vendor's TDS ledger
- `GET /tds-sections` → List all TDS sections

(See [API Endpoints](#api-endpoints) section for full details)

---

### 6. **Main App** (`src/index.js`)

**Express Configuration:**

```javascript
const app = express();
const PORT = process.env.PORT ?? 3000;
```

**Middleware:**
- `cors()` → Cross-Origin Resource Sharing
  - Allowed origins: localhost, Vercel production
  - Methods: GET, POST, PATCH, DELETE
  - Headers: Content-Type, Authorization

- `express.json()` → Parse JSON request bodies

**Routes:**
- `GET /health` → Health check
- `POST/PATCH/GET /api/*` → Invoice & vendor routes

**Error Handler:**
- Global middleware catches all errors
- Returns 500 status + error message

---

## 💾 Database Schema

### Table: `vendors`
```sql
CREATE TABLE vendors (
  id BIGINT PRIMARY KEY,
  company_name VARCHAR(255) NOT NULL,
  gstin VARCHAR(15) UNIQUE,
  pan VARCHAR(10),
  vendor_type VARCHAR(50),
  email VARCHAR(255),
  phone VARCHAR(20),
  address TEXT,
  city VARCHAR(100),
  state VARCHAR(100),
  pincode VARCHAR(10),
  bank_account VARCHAR(50),
  ifsc VARCHAR(11),
  bank_name VARCHAR(100),
  is_msme BOOLEAN DEFAULT FALSE,
  msme_registration_no VARCHAR(50),
  tds_exempt BOOLEAN DEFAULT FALSE,
  tds_exempt_reason TEXT,
  tds_exempt_upto DATE,
  default_tds_section_id BIGINT,
  notes TEXT,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Table: `invoices`
```sql
CREATE TABLE invoices (
  id BIGINT PRIMARY KEY,
  vendor_id BIGINT REFERENCES vendors,
  vendor_name VARCHAR(255),
  vendor_gstin VARCHAR(15),
  buyer_gstin VARCHAR(15),
  amount NUMERIC(15,2),
  taxable_amount NUMERIC(15,2),
  invoice_date DATE,
  invoice_number VARCHAR(50),
  financial_year VARCHAR(10),
  cgst NUMERIC(10,2),
  sgst NUMERIC(10,2),
  igst NUMERIC(10,2),
  gst_rate NUMERIC(5,2),
  is_igst BOOLEAN,
  place_of_supply VARCHAR(100),
  hsn_sac VARCHAR(50),
  description TEXT,
  line_items JSONB,
  tds_applicable BOOLEAN DEFAULT FALSE,
  tds_rate NUMERIC(5,2),
  tds_amount NUMERIC(10,2),
  tds_section_id BIGINT REFERENCES tds_sections,
  net_payable NUMERIC(15,2),
  status VARCHAR(50) DEFAULT 'pending',
  payment_status VARCHAR(50) DEFAULT 'unpaid',
  confidence_score NUMERIC(3,2),
  source VARCHAR(50),
  reviewed_by VARCHAR(255),
  reviewed_at TIMESTAMP,
  notes TEXT,
  raw_data JSONB,
  created_at TIMESTAMP,
  updated_at TIMESTAMP
);
```

### Table: `tds_sections`
```sql
CREATE TABLE tds_sections (
  id BIGINT PRIMARY KEY,
  section VARCHAR(10) UNIQUE,
  sub_type VARCHAR(100),
  nature_of_payment VARCHAR(255),
  threshold_aggregate NUMERIC(15,2),
  threshold_single NUMERIC(15,2),
  rate_individual NUMERIC(5,2),
  rate_company NUMERIC(5,2),
  rate_no_pan NUMERIC(5,2),
  description TEXT,
  is_active BOOLEAN DEFAULT TRUE,
  created_at TIMESTAMP
);
```

### Table: `vendor_tds_ledger`
```sql
CREATE TABLE vendor_tds_ledger (
  id BIGINT PRIMARY KEY,
  vendor_id BIGINT REFERENCES vendors,
  financial_year VARCHAR(10),
  tds_section_id BIGINT REFERENCES tds_sections,
  total_invoiced NUMERIC(15,2),
  total_tds_deducted NUMERIC(10,2),
  invoice_count INTEGER,
  threshold_crossed BOOLEAN,
  updated_at TIMESTAMP
);
```

### View: `vendor_payment_summary`
```sql
CREATE VIEW vendor_payment_summary AS
SELECT 
  v.*,
  COUNT(DISTINCT i.id) as total_invoices,
  COALESCE(SUM(i.amount), 0) as total_amount,
  COALESCE(SUM(i.tds_amount), 0) as total_tds_deducted
FROM vendors v
LEFT JOIN invoices i ON v.id = i.vendor_id
GROUP BY v.id;
```

---

## ✨ Features

### ✅ Implemented

- **AI Invoice Extraction**
  - PDF text extraction via pdfjs
  - Groq LLaMA API for structured data extraction
  - 16+ fields extracted: vendor, GST, amounts, dates, line items
  - Confidence scoring

- **Vendor Management**
  - Auto-match by GSTIN (unique identifier)
  - Fuzzy name matching for unstructured data
  - Auto-create vendor from invoice data
  - Manual vendor creation via API
  - Update vendor profiles

- **TDS Calculations**
  - Indian TDS thresholds (194C, 194J, etc.)
  - Rate based on PAN availability & vendor type
  - Cumulative tracking per FY & section
  - Threshold crossing logic (TDS from first rupee)
  - Exemption handling

- **Invoice Workflow**
  - Upload → Extract → Match Vendor → Approve/Reject
  - Approval with TDS calculation
  - Rejection with reason logging
  - Status tracking (pending, approved, rejected)
  - Payment status tracking (unpaid, paid, partial)

- **Financial Year Tracking**
  - Indian FY: April 1 - March 31
  - Automatic FY derivation from dates
  - Per-FY TDS ledger maintenance

- **Pagination & Filtering**
  - List invoices by status, vendor, FY, date range
  - List vendors with search, type, MSME, exemption filters
  - Pagination with limit/offset

---

## 🔒 Security & Best Practices

1. **Environment Variables**
   - Sensitive keys in `.env` (not committed)
   - Service key for database admin operations

2. **Database**
   - Supabase Row-Level Security (RLS) policies
   - Constraints: UNIQUE GSTIN, Foreign keys, NOT NULL validations

3. **File Upload**
   - Multer memory storage (no disk persistence)
   - File size limit: 20MB
   - MIME type whitelist: PDF, JPG, PNG

4. **CORS**
   - Restricted to known origins
   - Specific HTTP methods allowed

5. **Error Handling**
   - Global error handler in Express
   - Detailed error logging
   - Appropriate HTTP status codes

---

## 📝 Notes

- **Groq API Key:** Required for invoice extraction. Get from https://console.groq.com
- **Supabase Setup:** Ensure all tables & views are created in PostgreSQL
- **Financial Year:** System assumes Indian FY (April-March)
- **TDS Sections:** Pre-populate `tds_sections` table with company's applicable sections
- **CORS Origins:** Update in `src/index.js` for production deployment

---

## 📚 References

- [Express.js Documentation](https://expressjs.com)
- [Supabase Docs](https://supabase.io/docs)
- [Groq API Reference](https://console.groq.com/docs)
- [Indian TDS Rules](https://www.incometaxindia.gov.in)
- [PDF.js Documentation](https://mozilla.github.io/pdf.js)

---

**Version:** 1.0.0  
**Last Updated:** September 2026  
**Maintainer:** Finance Automation Team

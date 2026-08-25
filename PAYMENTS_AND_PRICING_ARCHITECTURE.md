# 💳 GeoQuerry Payment Gateway & Pricing Architecture Specification

## 1. Dual Payment Gateway Architecture

GeoQuerry is architected with a hybrid checkout engine designed for Kenyan domestic users (via Safaricom M-Pesa STK Push) and international global users (via Paystack for USD/KES Visa, Mastercard, American Express, and Apple Pay).

```
                      ┌───────────────────────────────────────────────┐
                      │              GEOQUERRY CHECKOUT               │
                      └──────────────────────┬────────────────────────┘
                                             │
                      ┌──────────────────────┴────────────────────────┐
                      │                                               │
           [ Local Kenyan Currency: KES ]               [ Global Currency: USD ]
                      │                                               │
         ┌────────────┴────────────┐                                  │
         ▼                         ▼                                  ▼
┌──────────────────┐     ┌──────────────────┐               ┌──────────────────┐
│  M-Pesa STK Push │     │   Card/Apple Pay │               │   Card/Apple Pay │
│ (Safaricom PIN)  │     │   (Visa/Master)  │               │ (Visa/Master/Amex│
│                  │     │   via Paystack   │               │   Apple Pay)     │
└────────┬─────────┘     └────────┬─────────┘               └────────┬─────────┘
         │                        │                                  │
         ▼                        ▼                                  ▼
┌──────────────────┐     ┌─────────────────────────────────────────────────────┐
│  M-Pesa Webhook  │     │                  Paystack Webhook                   │
│  (/webhooks/     │     │             (/webhooks/paystack)                    │
│   mpesa)         │     │                                                     │
└────────┬─────────┘     └──────────────────────────┬──────────────────────────┘
         │                                          │
         └────────────────────┬─────────────────────┘
                              ▼
               ┌──────────────────────────────┐
               │    PostgreSQL Auto-Upgrade   │
               │   user_profiles.subscription │
               └──────────────────────────────┘
```

---

## 2. Single-Source Master Enterprise Pricing Matrix

All pricing tiers, currencies, and billing cycles across GeoQuerry are algorithmically derived from **one single value: the Master Enterprise Monthly Rate** (stored persistently in the PostgreSQL `system_settings` table).

* **Master Input**: Enterprise Base Monthly Rate ($E$, default: $\text{KSh } 2,000$).
* **Currency Conversion**: Fixed conversion benchmark at $130 \text{ KES/USD}$ with rounded integer pricing.
* **Annual Billing**: $20\%$ discount on annual commitments ($\text{Monthly} \times 12 \times 0.8$).

| Subscription Tier | Enterprise Ratio | Monthly Price (KES) | Monthly Price (USD) | Annual Price (KES) [20% Off] | Annual Price (USD) [20% Off] |
| :--- | :---: | :---: | :---: | :---: | :---: |
| **Enterprise (`premium`)** | **$100\%$ (Master Base)** | **$\text{KSh } 2,000 / \text{mo}$** | **$\$15 / \text{mo}$** | **$\text{KSh } 19,200 / \text{yr}$** | **$\$144 / \text{yr}$** |
| **Professional (`pro`)** | **$50\%$ of Enterprise** | **$\text{KSh } 1,000 / \text{mo}$** | **$\$8 / \text{mo}$** | **$\text{KSh } 9,600 / \text{yr}$** | **$\$77 / \text{yr}$** |
| **Student Academic (`student`)** | **$15\%$ of Enterprise** | **$\text{KSh } 300 / \text{mo}$** | **$\$2 / \text{mo}$** | **$\text{KSh } 2,880 / \text{yr}$** | **$\$19 / \text{yr}$** |
| **Free Explorer (`free`)** | **$0\%$** | **$\text{KSh } 0 / \text{mo}$** | **$\$0 / \text{mo}$** | **$\text{KSh } 0 / \text{yr}$** | **$\$0 / \text{yr}$** |

---

## 3. Discount Stacking & Promotional Voucher Rules

1. **Multiplicative Stacking Formula**:
   When a user has an active Benefit Tier (e.g. $40\%$ Beta Dev discount) and applies a promotional code (e.g. $20\%$ voucher), the discounts stack multiplicatively on the remainder:
   $$\text{Final Price} = \text{Base Price} \times \left(1 - \frac{\text{Tier Discount}}{100}\right) \times \left(1 - \frac{\text{Promo Discount}}{100}\right)$$
   $$\text{Total Effective Discount} = \left(1 - (1 - 0.40) \times (1 - 0.20)\right) \times 100 = 52\%$$

2. **Promo Voucher Limitation**: Strictly maximum of **1 promo voucher** per checkout session.

---

## 4. API Endpoints & Gateway Routes

| Endpoint | Method | Description | Auth Required |
| :--- | :---: | :--- | :---: |
| `/api/pricing/plans` | `GET` | Fetch all active tier rate cards & master rate | Public |
| `/api/pricing/quote` | `GET` | Calculate personalized quote with promo & tier discount | User / Public |
| `/api/pricing/validate-promo` | `POST` | Validate promotional voucher code | Public |
| `/api/checkout/mpesa/stk-push` | `POST` | Trigger Safaricom M-Pesa STK push prompt | User |
| `/api/checkout/mpesa/status/:ref`| `GET` | Poll M-Pesa payment completion status | User |
| `/api/checkout/paystack/initialize` | `POST`| Initialize Paystack global card & Apple Pay session | User |
| `/api/webhooks/mpesa` | `POST` | Safaricom Daraja STK callback webhook | Gateway |
| `/api/webhooks/paystack` | `POST` | Paystack HMAC SHA512 verified event webhook | Gateway |
| `/api/admin/pricing-plans/master-rate` | `PUT` | Update single master rate & persist to DB | Lead Admin |

---

## 5. Environment Variables

Add to `backend/.env.local`:

```env
# Database Settings
DATABASE_URL=postgresql://neondb_owner:...@...neon.tech/neondb?sslmode=require

# Paystack (Global Cards, Apple Pay, Kenyan Bank/M-Pesa Settlements)
PAYSTACK_SECRET_KEY=sk_test_...
PAYSTACK_PUBLIC_KEY=pk_test_...

# Safaricom M-Pesa Daraja
MPESA_CONSUMER_KEY=...
MPESA_CONSUMER_SECRET=...
MPESA_PASSKEY=bfb279f9aa9bdbcf158e97dd71a467cd2e0c893059b10f78e6b72ada1ed2c919
MPESA_SHORTCODE=174379
MPESA_CALLBACK_URL=https://api.geoquerry.com/api/webhooks/mpesa
```

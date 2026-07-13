# MetaEscrow

MetaEscrow is a secure web-based escrow platform designed to protect buyers and sellers during online transactions. It acts as a trusted third party by securely holding funds until both parties fulfill the agreed transaction conditions.

The project is being developed as a Final Year Software Engineering Project and is intended to evolve into a commercial platform capable of serving users across Nigeria and, eventually, internationally.

---

## Project Vision

To become Nigeria's safest escrow platform and a trusted competitor to Escrow.com by providing secure, transparent, and reliable online transaction services.

---

## Objectives

- Reduce online fraud.
- Increase trust in e-commerce transactions.
- Protect buyers and sellers.
- Provide transparent transaction tracking.
- Support both marketplace and custom escrow transactions.

---

## Technology Stack

### Frontend
- HTML5
- Tailwind CSS
- JavaScript (ES6 Modules)

### Backend
- Node.js
- Express.js

### Database
- Firebase Firestore

### Authentication
- Firebase Authentication

### Payments
- Paystack (Manual approval in MVP)

### Hosting
- Netlify

### Version Control
- Git & GitHub

---

## Folder Structure

```
MetaEscrow/
│
├── client/
│   ├── index.html
│   ├── login.html
│   ├── register.html
│   ├── dashboard.html
│   ├── marketplace.html
│   ├── wallet.html
│   ├── escrow.html
│   ├── admin.html
│   │
│   ├── js/
│   ├── css/
│   ├── assets/
│   └── components/
│
├── server/
│
├── README.md
└── .gitignore
```

---

## User Roles

### Guest

Can:

- Browse landing page
- Register
- Login

---

### Registered User

Can:

- Edit profile
- Fund wallet
- Create escrow
- Buy products
- Sell products (subject to verification rules)
- Raise disputes
- Rate completed transactions

---

### Verified User

Can:

- List products above ₦20,000
- Enjoy increased transaction limits

Verification requires:

- National ID
- Selfie
- Utility Bill

---

### Administrator

Can:

- Verify users
- Approve wallet funding
- Approve withdrawals
- Suspend users
- Delete products
- Resolve disputes
- View reports

---

## Escrow Workflow

1. Buyer creates transaction.
2. Seller accepts transaction.
3. Buyer funds escrow.
4. Funds are held securely.
5. Seller delivers goods or services.
6. Buyer confirms delivery.
7. Funds are released to the seller.
8. If a dispute occurs, the administrator reviews evidence and decides whether to release or refund the funds.

---

## Marketplace Rules

- Unverified users can list products up to ₦20,000.
- Verified users can list products of any value.
- Every completed transaction supports mutual ratings between buyer and seller.

---

## Future Roadmap

- Mobile application
- Blockchain escrow
- Cryptocurrency support
- AI fraud detection
- BVN/NIN verification
- International payments
- Push notifications
- In-app messaging

---

## Development Workflow

Every completed feature should be committed to GitHub.

Example:

```bash
git add .
git commit -m "Implement authentication module"
git push
```

---

## License

This project is licensed under the MIT License.

---

## Author

**Aliyu Garba Musa (MetaGie)**

B.Sc. Software Engineering

Nigerian Army University Biu

Final Year Project

2026

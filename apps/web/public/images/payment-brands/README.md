Card brand marks are local SVG vectors. Brand names and marks remain trademarks
of their respective owners; inclusion here does not grant trademark rights.

- `cartes-bancaires.svg`, `eftpos-au.svg`, `elo.svg`, `jcb.svg`, and
  `unionpay.svg` come from
  ActiveMerchant's payment icon set (MIT). The upstream license is included in
  `LICENSE-activemerchant-MIT.txt`:
  https://github.com/activemerchant/payment_icons/tree/master/app/assets/images/payment_icons
- `amex-mark.svg` uses the Simple Icons American Express vector (CC0-1.0);
  the upstream license is included in `LICENSE-simple-icons-CC0-1.0.txt`:
  https://github.com/simple-icons/simple-icons/tree/develop/icons/americanexpress.svg
- `diners-club.svg`, `discover.svg`, and `hipercard.svg` use colored vectors from
  `aaronfagan/svg-credit-card-payment-icons` (Apache-2.0). The upstream license
  is included in `LICENSE-aaronfagan-Apache-2.0.txt`:
  https://github.com/aaronfagan/svg-credit-card-payment-icons/tree/main/logo
- `link.svg` uses the Link icon mark from Stripe's official site: https://link.com/
  No standalone license grant for this mark was found; use remains subject to
  Stripe's applicable marks guidance.
- Visa and Mastercard remain inline in
  `apps/web/features/platform-billing/components/CardBrandMark.tsx` to keep
  the user-approved artwork and spacing explicit.

Only generic outer card frames/shadows were removed from payment icon assets;
brand-colored backgrounds and logo paths are preserved.

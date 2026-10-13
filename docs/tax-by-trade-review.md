# Tax-by-trade review — 13 October 2026

Scope: UK individual sole-trader bookkeeping and estimates for 2026/27. This is an implementation review, not accountant sign-off or confirmation that every circumstance is supported.

## Implemented in this batch

Original spending is retained. Manual expenses, receipt scans and recurring costs can carry `allowable`, `excluded`, `review` or legacy treatment and a business-use percentage. Only the business portion of a reviewed allowable cost, less recorded reclaimable VAT, enters the estimated deduction. New unreviewed costs contribute zero until reviewed. Legacy records retain the old deduction and are labelled unreviewed; no retrospective classification is inferred from job title or category. CSV records include treatment, percentage and deduction. Quick expense presets open a review form.

The dashboard spending/profit views continue to show recorded amounts, which may include personal/non-deductible spending. The Tax view uses estimated allowable costs. Regular costs remain spread budget estimates, not a cash-basis payment ledger. Catch-up totals still assume allowable amounts and are flagged provisional. These are explicit remaining limitations.

## Shared calculation checks

Existing 2026/27 Income Tax bands (including Scotland), personal-allowance taper, Class 4 6%/2%, student Plans 1/2/4/5 thresholds £26,900/£29,385/£33,795/£25,000 and postgraduate £21,000 match the current published guidance inspected. Existing pension/Gift Aid regression tests cover ordinary qualifying relief-at-source band extension and boundaries. Marriage Allowance £1,260 transfer/£252 credit remains conditional on eligibility.

These checks do not validate every pension eligibility limit, Gift Aid tax shortfall, age exemption from Class 4, loss relief, multiple student plans/PAYE repayment offsets, savings/dividends, capital allowances, payments on account, trading allowance choice or historic/future tax years. Rates are currently fixed to 2026/27. Professional review and dedicated support remain needed for these cases.

## Profession mapping

All listed expense examples require business purpose, evidence and any private-use apportionment. They are suggestions, not automatic deductibility decisions.

| Group | Expense review emphasis | Further checks |
|---|---|---|
| Driving & delivery | Fuel, insurance, repairs, licensing, platform charges | Actual costs versus mileage; vehicle eligibility; no double claim; car capital allowances; finance principal |
| Building & trades (including carpenter, joiner, electrician) | Materials, tools, equipment hire, protective workwear | CIS can apply to these roles, not just a role explicitly named subcontractor; equipment accounting method |
| Cleaning & property services (including window cleaner) | Cleaning supplies, tools, insurance, travel | Private use; ordinary clothing; working-at-home allocation |
| Hair & beauty | Business consumables, salon/chair rent, equipment | Personal treatments and products; qualifying training; capital treatment |
| Freelance & professional / IT | Software, professional fees, phone, office costs | Private-use split; homeworking method; new-trade training |
| Creative & media | Business production costs, software, equipment | Ordinary clothes/private purchases; certain authors/artists may qualify for separate averaging relief |
| Retail, online selling & crafts | Stock, raw materials, marketplace fees, postage | Private withdrawals; stock accounting method; equipment |
| Food, catering & events | Ingredients, business supplies, venue and equipment hire | Personal food and entertainment; equipment; VAT treatment depends on supply |
| Fitness & wellbeing | Venue hire, business equipment, insurance | Personal gym/ordinary sportswear not automatically allowable; qualifying training |
| Tutoring & education | Teaching materials, software, professional costs | Homeworking; travel facts; VAT exemption eligibility requires separate assessment |
| Health & care | Business consumables, insurance, professional fees | Private use; service/provider-specific VAT rules |
| Repairs & maintenance | Parts, tools, protective workwear | CIS where applicable; equipment; finance |
| Pet services | Business supplies, insurance, advertising | Personal pet costs; private travel |
| Other/custom | Shared business-expense rules | No new tax rules inferred from custom text |
| Property letting | Dedicated property accounts and allowable rental expenses | Separate income source, residential finance-cost tax reduction and loss rules; unavailable specialist flow |
| Childcare | Childminding costs and documented allocation | HMRC guidance distinguishes MTD users from non-MTD for wear-and-tear/household methods; unavailable specialist flow |
| Farming | Farm accounts, equipment and livestock | Eligible 2/5-year averaging excludes cash basis; herd and loss rules; unavailable specialist flow |

## Specialist build requirements

- CIS: record gross receipts, materials, deductions and net receipts separately. Deductions are tax paid on account, not business expenses. Ask about CIS across relevant roles; job title alone is insufficient. Verify rates, evidence, gross-payment status and VAT reverse-charge eligibility before enabling.
- Property: keep rental accounts separate from trading profit; model finance-cost restrictions and property losses explicitly. Do not treat a rental-income field as full landlord support.
- Childminding: select applicable MTD/non-MTD method, establish eligibility and avoid claiming replacement costs twice with a wear-and-tear deduction.
- Farming: establish accounting method and averaging eligibility and preserve multiple years of profit; no automatic averaging from one current-year total.
- Mileage: official current page states 55p for the first 10,000 eligible car/goods-vehicle miles in 2026/27 and 25p thereafter; earlier years differ. Existing mileage tracking does not implement a reviewed vehicle-method tax deduction. Do not silently deduct tracked miles alongside actual vehicle costs.

## Primary sources inspected

- https://www.gov.uk/expenses-if-youre-self-employed
- https://www.gov.uk/expenses-if-youre-self-employed/office-property
- https://www.gov.uk/expenses-if-youre-self-employed/travel
- https://www.gov.uk/expenses-if-youre-self-employed/clothing
- https://www.gov.uk/expenses-if-youre-self-employed/training-courses
- https://www.gov.uk/expenses-if-youre-self-employed/legal-financial
- https://www.gov.uk/income-tax-rates
- https://www.gov.uk/scottish-income-tax
- https://www.gov.uk/self-employed-national-insurance-rates
- https://www.gov.uk/repaying-your-student-loan/what-you-pay
- https://www.gov.uk/tax-on-your-private-pension/pension-tax-relief
- https://www.gov.uk/donating-to-charity/gift-aid
- https://www.gov.uk/marriage-allowance
- https://www.gov.uk/what-is-the-construction-industry-scheme
- https://www.gov.uk/renting-out-a-property/paying-tax
- https://www.gov.uk/guidance/changes-to-tax-relief-for-residential-landlords-how-its-worked-out-including-case-studies
- https://www.gov.uk/guidance/claiming-expenses-and-keeping-records-if-youre-a-childminder
- https://www.gov.uk/government/publications/farmers-and-market-gardeners-hs224-self-assessment-helpsheet/hs224-farmers-and-market-gardeners-2026
- https://www.gov.uk/hmrc-internal-manuals/business-income-manual/bim84001
- https://www.gov.uk/simpler-income-tax-simplified-expenses/vehicles

## Verification

Run the Scottish relief, tax history, expense-tax calculation and mobile browser suites. Database rollback checks must cover constraints, owner-only writes and receipt atomic persistence before publication. Verify production matches the reviewed commit. Remaining specialist work above must stay visibly unsupported.

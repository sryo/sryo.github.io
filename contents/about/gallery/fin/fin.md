---
title: "Fin: What if receipts entered themselves?"
date: 2024-08-01
tags: [Swift, iOS, CoreML, Finance]
---

Every budgeting app I've tried dies the same death: I stop entering expenses. The friction of typing amounts kills the habit within a week.

[Fin](https://github.com/sryo/Fin) skips the typing. Point your camera at a receipt, and it extracts the total, merchant, and date using an on-device ML model. It suggests a category based on where you shopped. Confirm and done.

The spending view is a treemap—bigger rectangles mean more money spent in that category. No line graphs, no complicated dashboards. Just a quick visual answer to "where did my money go this month?" Built specifically for Argentina, so it handles our comma-decimal formatting and recognizes local merchants like MercadoPago and Brubank.

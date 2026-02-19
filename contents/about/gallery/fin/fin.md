---
title: "Fin: What if receipts scanned themselves?"
date: 2024-08-01
tags: [Swift, iOS, CoreML, Finance]
---

Every budgeting app I've tried dies the same death: I stop entering expenses. The friction of typing amounts kills the habit within a week.

[Fin](https://github.com/sryo/Fin) skips the typing. Point your camera at a receipt, and it extracts the total, merchant, and date using an on-device ML model. It suggests a category based on where you shopped. Confirm and done.

The spending view is a treemap. Bigger rectangles mean more money spent in that category. No line graphs, no complicated dashboards. Just a quick visual answer to "where did my money go this month?" Built specifically for Argentina, so it handles our comma-decimal formatting and recognizes local merchants like MercadoPago and Brubank.

<iframe style="border: 1px solid rgba(0, 0, 0, 0.1);" width="100%" height="450" src="https://embed.figma.com/design/ImOSeVmQP0GZQtLH1HicRr/Fin?node-id=0-1&embed-host=share" allowfullscreen></iframe>

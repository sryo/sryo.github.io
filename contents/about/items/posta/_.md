---
title: "Posta: What if email was sorted?"
date: 2024-03-01
tags: [Tauri, SolidJS, Rust, Email]
---

Gmail's interface has everything. That's the problem. Email processing is parallel. You scan for urgent items, check newsletters later, batch through work threads. But inbox UI is linear. One list, one scroll.

I wanted something closer to a Kanban board. Multiple columns showing different filtered views at once. Starred emails here, newsletters there, work stuff in another lane.

[Posta](https://sryo.github.io/Posta/) is a desktop Gmail client built around cards. Each card is a saved search query showing matching threads. The query complexity hides behind a simple label. You can batch-reply to multiple conversations, drag cards to reorder your view, and switch between accounts instantly.

I'm not trying to replace Gmail. Just make it less overwhelming for how I actually use email.

<iframe style="border: 1px solid rgba(0, 0, 0, 0.1);" width="100%" height="450" src="https://embed.figma.com/design/DT81TTh16DyX61w01ThWh0/Posta?node-id=6-438&embed-host=share" allowfullscreen></iframe>

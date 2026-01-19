---
title: "Posta: What if email was sorted?"
date: 2024-03-01
tags: [Tauri, SolidJS, Rust, Email]
---

Gmail's interface has everything. That's the problem. I wanted something closer to a Kanban board—multiple columns showing different filtered views of my inbox at once. Starred emails here, newsletters there, work stuff in another lane.

[Posta](https://sryo.github.io/Posta/) is a desktop Gmail client built around cards. Each card is a saved search query showing matching threads. You can batch-reply to multiple conversations, drag cards to reorder your view, and switch between accounts instantly. The backend is Rust talking to Gmail's API; the frontend is SolidJS.

I'm not trying to replace Gmail—just make it less overwhelming for how I actually use email.

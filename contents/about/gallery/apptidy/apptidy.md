---
title: "AppTidy: What if forgotten apps closed themselves?"
date: 2024-05-01
tags: [Swift, macOS, Utility]
---

I have a bad habit of leaving apps open. Slack minimized, Figma in the background, three Finder windows I forgot about. By afternoon my Mac is sluggish and I can't remember what I was actually working on.

[AppTidy](https://github.com/sryo/AppTidy) watches for apps with no visible windows and closes them after a configurable timeout. It won't touch anything playing audio, and it keeps a 5-second undo buffer in case you close something by accident (Cmd+Option+Z brings it back).

It's a menu bar app—no dock icon, no interface to manage. Just quiet cleanup happening in the background.

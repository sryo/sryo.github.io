---
title: "AirNod: What if your head was a mouse?"
date: 2024-04-01
tags: [Swift, macOS, Accessibility]
---

AirPods have motion sensors. Your Mac has accessibility APIs. [AirNod](https://github.com/sryo/AirNod) connects them.

Tilt your head down to scroll. Tilt left to click, right to right-click. Shake your head to recenter. The app lives in your menu bar, plays silent audio to keep the sensors active, and gives you heartbeat-like haptic feedback so you know it's working.

I built this for people who can't use a traditional mouse. Motor disabilities, repetitive strain injuries, or just situations where your hands are occupied. The calibration takes three seconds, and there's a dead zone setting so small head movements don't trigger anything. It's surprisingly usable once you get the sensitivity dialed in.

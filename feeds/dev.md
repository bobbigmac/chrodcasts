# Site
- id: vodcasts-dev
- title: VODcasts (Dev)
- subtitle: Static vodcast browser
- description: Small feed set for fast local dev.
- base_path: /

# Defaults
- min_hours_between_checks: 0
- request_timeout_seconds: 25
- user_agent: actual-plays/vodcasts (+https://github.com/)

# Feeds

## eaglebrook
- url: https://www.eaglebrookchurch.com/mediafiles/eagle-brook-church-videocast.xml
- title: Eagle Brook Church (videocast)
- category: church
- fetch_via: auto

## twit_twit
- url: https://feeds.twit.tv/twit_video_hd.xml
- title: This Week in Tech
- category: twit
- fetch_via: auto


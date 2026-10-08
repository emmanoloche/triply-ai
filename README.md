<h1 align="center">✈️ Full-Stack AI Trip Planner Mobile App ✈️</h1>

![Demo App](/assets/images/screenshot-for-readme.png)

✨ **Highlights:**

- 📱 Fully Functional Mobile App built with React Native & Expo
- 🤖 AI-Powered Trip Planning with OpenAI
- 🧑‍💻 Beginner-Friendly Structured Workflow
- 📱 Cross-Platform Support for iOS & Android
- 🔐 Authentication with Clerk
- 🌐 Google Sign-In Support
- 🍎 Apple Sign-In Support
- 🏠 Home Screen with latest trip and popular destinations
- 🚀 Generate Personalized Trips with AI
- 🗺️ Trip Details Screen with full itinerary
- 📅 Day-by-Day Travel Planning
- 📍 Places to Visit, Activities & Map Locations
- 💬 AI Assistant to Modify and Improve Trips
- 🧳 Trips Screen to view all generated travel plans
- 👤 Profile Screen with account details
- 🚪 Secure Logout Flow
- 🗑️ Delete Account with full database cleanup
- ⭐ Rate App Button for App Store reviews
- 🎨 Modern iOS Liquid Glass Tab Effect using Expo Native Tabs
- 🧠 AI-Generated UI Mockups and Design System
- 🎨 Custom Colors, Fonts, Typography & Components
- 🧩 Build Screens One by One from Upscaled Designs
- 🗄️ PostgreSQL Database for persistent data storage
- ☁️ Cloud Database Hosting with Neon
- ⚡ Background Jobs with Inngest
- 🖼️ Destination Images with Unsplash
- 📤 Image Uploads & Optimizations with ImageKit
- 🐞 Error Tracking & Monitoring with Sentry
- 🤖 AI Code Review with CodeRabbit
- 🌐 Landing Page for the App
- 📄 Privacy Policy, Terms of Service & Support Page
- 🚀 App Store-Ready Project Structure
- 🆓 100% Free Setup to Get Started
- 📂 Full Source Code Provided
- 🎯 Real Product You Can Share, Launch & Monetize

---

# 🧪 `.env` Setup

Create a `.env` file in the **root of the project** and add the following variables:

```bash
EXPO_PUBLIC_CLERK_PUBLISHABLE_KEY=<your_clerk_publishable_key>
CLERK_SECRET_KEY=<your_clerk_secret_key>
CLERK_WEBHOOK_SIGNING_SECRET=<your_clerk_webhook_signing_secret>
DATABASE_URL=<your_neon_postgres_database_url>
OPENAI_API_KEY=<your_openai_api_key>
UNSPLASH_ACCESS_KEY=<your_unsplash_access_key>
UNSPLASH_SECRET_KEY=<your_unsplash_secret_key>
INNGEST_DEV=<your_inngest_dev_value>
IMAGEKIT_PRIVATE_KEY=<your_imagekit_private_key>
IMAGEKIT_PUBLIC_KEY=<your_imagekit_public_key>
IMAGEKIT_URL_ENDPOINT=<your_imagekit_url_endpoint>
SENTRY_AUTH_TOKEN=<your_sentry_auth_token>
```

---

## 🔧 Run the App

```bash
npm install
npx expo run:ios
```

or

```bash
npx expo run:android
```

## 📱 Features Overview

### 🔐 Authentication

Users must sign in before using the app.

Supported authentication options:

- Google Sign-In
- Apple Sign-In

Authentication is handled using Clerk, making the login flow production-ready and easy to extend later.

### 🏠 Home Screen

The Home screen includes:

- Get Started button to generate a new trip
- Latest generated trip
- Popular destinations
- Beautiful mobile-first layout
- Native tab navigation with iOS Liquid Glass effect

### 🤖 AI Trip Generation

Users can generate a personalized trip by entering:

- Destination
- Travel dates
- Budget
- Number of travelers
- Interests
- Travel pace

OpenAI generates a complete trip plan in the background.

### 🗺️ Trip Details Screen

After generation, users are redirected to the Trip Details screen.

This screen includes:

- Full trip overview
- Day-by-day itinerary
- Places to visit
- Things to do
- Map with all trip locations

### 💬 AI Assistant

The AI Assistant lets users chat with AI and modify their trips using natural language.

Example requests:

- Make the trip more relaxed
- Add more local food spots
- Lower the budget
- Add more sightseeing
- Change the travel pace
- Customize the itinerary

### 🧳 Trips Screen

Users can view every trip they have generated in one place.

### 👤 Profile Screen

The Profile tab includes:

- User account details
- Logout button
- Delete account option
- Full database cleanup when account is deleted
- Rate App button

### 🌐 Web Pages

The project also includes App Store-ready web pages:

- Landing page
- Privacy policy
- Terms of service
- Support page with contact email

## 🛠️ Tech Stack

- React Native
- Expo
- TypeScript
- OpenAI
- Clerk
- PostgreSQL
- Neon
- Inngest
- Unsplash
- ImageKit
- Sentry
- CodeRabbit
- Expo Native Tabs

## 🚀 Deployment Ready

This project is built with a real production workflow in mind.

You can:

- Run it on your physical phone
- Share it with friends
- Test real AI trip generation
- Connect it to a production database
- Add App Store required pages
- Prepare it for publishing
- Use it as a real product

## 📂 Source Code

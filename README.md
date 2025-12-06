# 🎯 Vue Face Proctoring System

A real-time AI-powered proctoring system built with Vue 3, TypeScript, and face-api.js for monitoring exam integrity. This system includes 20+ detection features to ensure secure online examination environments.

![Vue](https://img.shields.io/badge/Vue.js-3.x-4FC08D?logo=vue.js&logoColor=white)
![TypeScript](https://img.shields.io/badge/TypeScript-5.x-3178C6?logo=typescript&logoColor=white)
![Vite](https://img.shields.io/badge/Vite-5.x-646CFF?logo=vite&logoColor=white)

## 🚀 Features

### 20 Real-Time Detection Capabilities

#### 📺 Screen & Application Monitoring
1. **Fullscreen Exit Detection** - Detects when user exits fullscreen mode
2. **Tab Switching Detection** - Monitors browser tab changes
3. **Application Switching** - Detects when user switches to other applications (Alt+Tab, window blur)
4. **Page Leave Detection** - Prevents page navigation attempts

#### ⌨️ Keyboard Monitoring (10 Blocked Actions)
5. **Ctrl+T** - New tab attempt
6. **Ctrl+W** - Tab close attempt
7. **Ctrl+R** - Page refresh attempt
8. **Ctrl+N** - New window attempt
9. **Ctrl+L** - Address bar focus attempt
10. **F11** - Fullscreen toggle attempt

#### 🎤 Audio Monitoring
11. **Voice Detection** - Detects sustained speech/sound through microphone with adaptive noise filtering

#### 👤 Face Detection & Tracking
12. **Face Not Detected** - Alerts when camera cannot detect a face
13. **Too Close** - Warns when user is closer than 30cm from camera
14. **Too Far** - Warns when user is farther than 80cm from camera

#### 🔄 Head Pose Detection
15. **Looking Up** - Detects head tilting upward (pitch > 15°)
16. **Looking Down** - Detects head tilting downward (pitch < -15°)
17. **Turning Right** - Detects head rotation to the right
18. **Turning Left** - Detects head rotation to the left

#### 👁️ Eye State Monitoring
19. **Eyes Closed** - Detects when both eyes are closed (blink detection with EAR algorithm)
20. **Partially Closed Eyes** - Detects inconsistent eye states

## 🎥 Advanced Features

- **Real-time Face Tracking** with visual feedback (circular overlay)
- **Screen Recording** with automatic upload to server
- **Photo Capture** every 30 seconds with automatic upload
- **Adaptive Audio Detection** with noise floor calibration
- **Violation Counter** tracking all infractions
- **Smooth Detection** using weighted averaging to reduce false positives

## 🛠️ Tech Stack

- **Frontend Framework**: Vue 3 (Composition API)
- **Language**: TypeScript
- **Build Tool**: Vite
- **Face Detection**: face-api.js (TinyFaceDetector + 68-point landmarks)
- **Audio Processing**: Web Audio API with bandpass filtering
- **Video Recording**: MediaRecorder API

## 📋 Prerequisites

- Node.js 16+ and npm/pnpm
- Modern browser with:
  - WebRTC support
  - MediaRecorder API
  - Fullscreen API
  - Web Audio API
- Camera and microphone permissions

## 🚀 Getting Started

### Installation

```bash
# Clone the repository
git clone https://github.com/ShohruxMurodovich/Proctoring.git
cd Proctoring

# Install dependencies
npm install
```

### Development

```bash
# Start development server with hot-reload
npm run dev
```

The application will be available at `http://localhost:5173`

### Production Build

```bash
# Type-check, compile and minify
npm run build

# Preview production build
npm run preview
```

### Linting

```bash
# Run ESLint
npm run lint
```

## 📁 Project Structure

```
vue-face/
├── public/
│   ├── models/              # Face-api.js model files
│   └── favicon.ico
├── src/
│   ├── components/
│   │   └── FullscreenModal.vue   # Fullscreen enforcement modal
│   ├── views/
│   │   └── MainView.vue          # Main proctoring interface
│   ├── router/
│   │   └── index.ts              # Vue Router configuration
│   ├── models/                   # Additional model files
│   ├── App.vue
│   └── main.ts
├── package.json
├── vite.config.ts
└── tsconfig.json
```

## 🔧 Configuration

### API Endpoints

The system uploads recordings and photos to:
```
https://proctor.platon.uz/services/platon-core/web/v1/public/files/upload/category/exam_video
```

To change the upload endpoint, modify the fetch URLs in `MainView.vue`:
- Line 609: Photo upload
- Line 718: Video upload

### Detection Thresholds

Key thresholds can be adjusted in `MainView.vue`:

```typescript
// Distance detection
const TOO_CLOSE = 300;  // 30cm
const TOO_FAR = 800;    // 80cm

// Head pose detection
const HEAD_TURN_THRESHOLD = 0.15;
const PITCH_THRESHOLD = 15;  // degrees

// Eye detection (EAR - Eye Aspect Ratio)
const BLINK_THRESHOLD = 0.22;
```

## 🎯 How It Works

### Face Detection Pipeline
1. **TinyFaceDetector** identifies faces in real-time
2. **68-point landmarks** track facial features
3. **EAR (Eye Aspect Ratio)** calculates eye openness
4. **Head pose estimation** using landmark geometry
5. **Distance calculation** based on face area

### Audio Monitoring
1. Microphone access with echo cancellation
2. Bandpass filter (1200Hz center frequency)
3. RMS level calculation from time-domain data
4. Adaptive noise floor calibration
5. Hysteresis-based speech detection

### Screen Recording
1. Screen capture via `getDisplayMedia`
2. MediaRecorder with optimized settings (640x360, 12fps, ~450kbps)
3. Automatic chunking and upload
4. 256MB maximum file size enforcement

## 🔐 Privacy & Security

- All processing happens client-side in the browser
- Camera/microphone streams are not stored locally
- Recordings are uploaded to configured server endpoint
- Users must grant explicit permissions for camera, microphone, and screen sharing

## 🌐 Browser Compatibility

| Browser | Support |
|---------|---------|
| Chrome  | ✅ Full Support |
| Edge    | ✅ Full Support |
| Firefox | ✅ Full Support |
| Safari  | ⚠️ Partial (some MediaRecorder limitations) |

## 📝 Recommended IDE Setup

- [VSCode](https://code.visualstudio.com/)
- [Volar](https://marketplace.visualstudio.com/items?itemName=Vue.volar) extension (disable Vetur)
- [TypeScript Vue Plugin](https://marketplace.visualstudio.com/items?itemName=Vue.vscode-typescript-vue-plugin)

## 🤝 Contributing

Contributions are welcome! Please feel free to submit a Pull Request.

## 📄 License

This project is licensed under the MIT License.

## 🙏 Acknowledgments

- [face-api.js](https://github.com/justadudewhohacks/face-api.js) for face detection
- Vue.js team for the amazing framework
- Platon.uz for API infrastructure

## 📞 Support

For issues, questions, or contributions, please open an issue on GitHub.

---

**Built with ❤️ using Vue 3 + TypeScript + face-api.js**

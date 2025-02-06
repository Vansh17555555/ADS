"use strict";
var __awaiter = (this && this.__awaiter) || function (thisArg, _arguments, P, generator) {
    function adopt(value) { return value instanceof P ? value : new P(function (resolve) { resolve(value); }); }
    return new (P || (P = Promise))(function (resolve, reject) {
        function fulfilled(value) { try { step(generator.next(value)); } catch (e) { reject(e); } }
        function rejected(value) { try { step(generator["throw"](value)); } catch (e) { reject(e); } }
        function step(result) { result.done ? resolve(result.value) : adopt(result.value).then(fulfilled, rejected); }
        step((generator = generator.apply(thisArg, _arguments || [])).next());
    });
};
var __importDefault = (this && this.__importDefault) || function (mod) {
    return (mod && mod.__esModule) ? mod : { "default": mod };
};
Object.defineProperty(exports, "__esModule", { value: true });
exports.app = void 0;
const express_1 = __importDefault(require("express"));
const simple_git_1 = __importDefault(require("simple-git"));
const path_1 = __importDefault(require("path"));
const promises_1 = __importDefault(require("fs/promises"));
const socket_io_1 = require("socket.io");
const http_1 = require("http");
const http_proxy_middleware_1 = require("http-proxy-middleware");
exports.app = (0, express_1.default)();
const httpServer = (0, http_1.createServer)(exports.app);
const io = new socket_io_1.Server(httpServer);
exports.app.use(express_1.default.json());
exports.app.use('/sites', express_1.default.static('repos', {
    index: ['index.html'],
    fallthrough: true
}));
// Add a middleware to handle SPA routing for each deployment
exports.app.get('/sites/:deploymentId/*', (req, res) => {
    const deploymentId = req.params.deploymentId;
    res.sendFile(path_1.default.join(__dirname, '../repos', deploymentId, 'index.html'));
});
// Track deployments and their servers in memory
const deployments = new Map();
const deploymentServers = new Map();
// Base port to start assigning from (e.g., 3001, since 3000 is main server)
const BASE_PORT = 3001;
io.on('connection', (socket) => {
    console.log('Client connected');
    socket.on('subscribe-to-deployment', (deploymentId) => {
        socket.join(`deployment-${deploymentId}`);
    });
});
// Modify the deploy endpoint to accept customDomain
exports.app.post('/deploy', (req, res) => __awaiter(void 0, void 0, void 0, function* () {
    var _a;
    const startTime = Date.now();
    const { repoUrl, customDomain } = req.body; // Accept customDomain in request
    const deploymentId = Date.now().toString();
    const deploymentPort = BASE_PORT + deploymentServers.size;
    console.log(`
🚀 DEPLOYMENT PROCESS STARTED
├── Time: ${new Date().toISOString()}
├── Repository: ${repoUrl}
├── Custom Domain: ${customDomain || 'none'}
└── Deployment ID: ${deploymentId}
    `);
    try {
        // Create directory
        const deployDir = path_1.default.join(__dirname, '../repos', deploymentId);
        console.log(`\n📁 STEP 1: Creating Directory: ${deployDir}`);
        yield promises_1.default.mkdir(deployDir, { recursive: true });
        console.log('✅ Directory created');
        // Clone repository
        const git = (0, simple_git_1.default)();
        console.log(`\n📥 STEP 2: Cloning Repository
├── From: ${repoUrl}
└── To: ${deployDir}
        `);
        yield git.clone(repoUrl, deployDir);
        console.log('✅ Repository cloned');
        // Check for package manager files
        console.log('\n📦 STEP 3: Detecting Package Manager');
        const files = yield promises_1.default.readdir(deployDir);
        console.log('📑 Found files:', files.join(', '));
        const hasPackageLock = files.includes('package-lock.json');
        const hasYarnLock = files.includes('yarn.lock');
        const hasPackageJson = files.includes('package.json');
        if (!hasPackageJson) {
            throw new Error('No package.json found in repository');
        }
        // Install dependencies
        console.log('\n📦 STEP 4: Installing Dependencies');
        const { execSync } = require('child_process');
        try {
            if (hasYarnLock) {
                console.log('🧶 Using Yarn');
                execSync('yarn install', {
                    cwd: deployDir,
                    stdio: 'inherit',
                    encoding: 'utf-8'
                });
            }
            else {
                console.log('📦 Using npm');
                execSync('npm install', {
                    cwd: deployDir,
                    stdio: 'inherit',
                    encoding: 'utf-8'
                });
            }
            console.log('✅ Dependencies installed');
        }
        catch (error) {
            console.error('❌ Dependency installation failed:', error);
            throw error;
        }
        // Build the project
        console.log('\n🏗️  STEP 5: Building Project');
        try {
            const packageJsonContent = require(path_1.default.join(deployDir, 'package.json'));
            if ((_a = packageJsonContent.scripts) === null || _a === void 0 ? void 0 : _a.build) {
                console.log(`
🔨 Starting Build Process
├── Build Command: ${hasYarnLock ? 'yarn build' : 'npm run build'}
├── Directory: ${deployDir}
└── Time: ${new Date().toISOString()}
                `);
                // First show the build script from package.json
                console.log('📄 Build script from package.json:', packageJsonContent.scripts.build);
                const buildCommand = hasYarnLock ? 'yarn build' : 'npm run build';
                // Execute build with direct output
                execSync(buildCommand, {
                    cwd: deployDir,
                    stdio: 'inherit', // This will show real-time output directly
                    env: Object.assign(Object.assign({}, process.env), { FORCE_COLOR: 'true' }) // Preserve colors
                });
                console.log('✅ Build completed successfully');
            }
            else {
                console.log('⚠️  No build script found in package.json');
            }
        }
        catch (err) {
            console.error('❌ Build failed:', err);
            throw err;
        }
        // Start the server
        console.log('\n🚀 STEP 6: Starting Deployment Server');
        const deploymentApp = (0, express_1.default)();
        // Determine the correct build output directory
        const buildDir = path_1.default.join(deployDir, 'dist'); // try dist first
        const fallbackBuildDir = path_1.default.join(deployDir, 'build'); // fallback to build
        // Check which build directory exists and use that
        let staticDir = deployDir; // default to root if no build dir found
        if (yield promises_1.default.access(buildDir).then(() => true).catch(() => false)) {
            console.log('📂 Using /dist directory for static files');
            staticDir = buildDir;
        }
        else if (yield promises_1.default.access(fallbackBuildDir).then(() => true).catch(() => false)) {
            console.log('📂 Using /build directory for static files');
            staticDir = fallbackBuildDir;
        }
        else {
            console.log('⚠️  No build directory found, using root directory');
        }
        // Serve static files from the correct directory
        deploymentApp.use(express_1.default.static(staticDir));
        deploymentApp.use((req, res, next) => {
            console.log(`📡 [${deploymentId}] ${req.method} ${req.path}`);
            next();
        });
        deploymentApp.get('*', (req, res) => {
            console.log(`🔄 [${deploymentId}] Serving SPA route: ${req.path}`);
            res.sendFile(path_1.default.join(staticDir, 'index.html'), {
                root: '/'
            });
        });
        const deploymentServer = (0, http_1.createServer)(deploymentApp);
        deploymentServer.listen(deploymentPort, () => {
            const deployTime = Date.now() - startTime;
            console.log(`
✨ DEPLOYMENT SUCCESSFUL
├── ID: ${deploymentId}
├── URL: http://localhost:${deploymentPort}
├── Time Taken: ${deployTime}ms
└── Status: Live
            `);
        });
        // Store deployment info
        const deploymentInfo = {
            status: 'success',
            url: `http://localhost:${deploymentPort}`,
            customDomain: customDomain ? `http://${customDomain}.localhost:3000` : undefined,
            repoUrl,
            port: deploymentPort,
            timestamp: new Date().toISOString(),
            deploymentTime: Date.now() - startTime
        };
        deployments.set(deploymentId, deploymentInfo);
        // Set up reverse proxy for custom domain
        if (customDomain) {
            exports.app.use((req, res, next) => {
                const host = req.headers.host;
                if (host === `${customDomain}.localhost:3000`) {
                    // Proxy the request to the actual deployment port
                    const proxy = (0, http_proxy_middleware_1.createProxyMiddleware)({
                        target: `http://localhost:${deploymentPort}`,
                        changeOrigin: true,
                        ws: true
                    });
                    return proxy(req, res, next);
                }
                next();
            });
            console.log(`
🌐 Custom Domain Configured
├── Domain: ${customDomain}.localhost:3000
└── Proxying to: http://localhost:${deploymentPort}
            `);
        }
        res.json({
            success: true,
            deploymentId,
            url: `http://localhost:${deploymentPort}`,
            customDomain: customDomain ? `http://${customDomain}.localhost:3000` : undefined
        });
    }
    catch (err) {
        const errorMessage = err instanceof Error ? err.message : 'Unknown error occurred';
        console.error(`
❌ DEPLOYMENT FAILED
├── ID: ${deploymentId}
├── Error: ${errorMessage}
├── Time: ${new Date().toISOString()}
└── Duration: ${Date.now() - startTime}ms
        `);
        if (err instanceof Error) {
            console.error('Stack trace:', err.stack);
        }
        deployments.set(deploymentId, {
            status: 'failed',
            error: errorMessage,
            repoUrl,
            timestamp: new Date().toISOString()
        });
        res.status(500).json({ error: errorMessage });
    }
}));
// Updated status endpoint to include logs
exports.app.get('/deployment/:id', (req, res) => {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
    }
    res.json(deployment);
});
httpServer.listen(3000, () => console.log('Server running on port 3000'));

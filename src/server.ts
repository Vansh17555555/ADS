import express, { Request, Response } from 'express';
import simpleGit from 'simple-git';
import path from 'path';
import fs from 'fs/promises';
import { Server } from 'socket.io';
import { createServer } from 'http';
import { createProxyMiddleware } from 'http-proxy-middleware';

export const app = express();
const httpServer = createServer(app);
const io = new Server(httpServer);

app.use(express.json());
app.use('/sites', express.static('repos', {
    index: ['index.html'],
    fallthrough: true
}));

// Add a middleware to handle SPA routing for each deployment
app.get('/sites/:deploymentId/*', (req: Request, res: Response) => {
    const deploymentId = req.params.deploymentId;
    res.sendFile(path.join(__dirname, '../repos', deploymentId, 'index.html'));
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

// Add these interfaces at the top
interface DeploymentInfo {
    status: string;
    url: string;
    customDomain?: string;
    repoUrl: string;
    port: number;
    timestamp: string;
    deploymentTime?: number;
}

// Modify the deploy endpoint to accept customDomain
app.post('/deploy', async (req: Request, res: Response): Promise<void> => {
    const startTime = Date.now();
    const { repoUrl, customDomain } = req.body;  // Accept customDomain in request
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
        const deployDir = path.join(__dirname, '../repos', deploymentId);
        console.log(`\n📁 STEP 1: Creating Directory: ${deployDir}`);
        await fs.mkdir(deployDir, { recursive: true });
        console.log('✅ Directory created');

        // Clone repository
        const git = simpleGit();
        console.log(`\n📥 STEP 2: Cloning Repository
├── From: ${repoUrl}
└── To: ${deployDir}
        `);
        await git.clone(repoUrl, deployDir);
        console.log('✅ Repository cloned');

        // Check for package manager files
        console.log('\n📦 STEP 3: Detecting Package Manager');
        const files = await fs.readdir(deployDir);
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
            } else {
                console.log('📦 Using npm');
                execSync('npm install', { 
                    cwd: deployDir, 
                    stdio: 'inherit',
                    encoding: 'utf-8'
                });
            }
            console.log('✅ Dependencies installed');
        } catch (error) {
            console.error('❌ Dependency installation failed:', error);
            throw error;
        }

        // Build the project
        console.log('\n🏗️  STEP 5: Building Project');
        try {
            const packageJsonContent = require(path.join(deployDir, 'package.json'));
            if (packageJsonContent.scripts?.build) {
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
                    env: { ...process.env, FORCE_COLOR: 'true' } // Preserve colors
                });

                console.log('✅ Build completed successfully');
            } else {
                console.log('⚠️  No build script found in package.json');
            }
        } catch (err) {
            console.error('❌ Build failed:', err);
            throw err;
        }

        // Start the server
        console.log('\n🚀 STEP 6: Starting Deployment Server');
        const deploymentApp = express();

        // Determine the correct build output directory
        const buildDir = path.join(deployDir, 'dist');  // try dist first
        const fallbackBuildDir = path.join(deployDir, 'build');  // fallback to build

        // Check which build directory exists and use that
        let staticDir = deployDir;  // default to root if no build dir found
        if (await fs.access(buildDir).then(() => true).catch(() => false)) {
            console.log('📂 Using /dist directory for static files');
            staticDir = buildDir;
        } else if (await fs.access(fallbackBuildDir).then(() => true).catch(() => false)) {
            console.log('📂 Using /build directory for static files');
            staticDir = fallbackBuildDir;
        } else {
            console.log('⚠️  No build directory found, using root directory');
        }

        // Serve static files from the correct directory
        deploymentApp.use(express.static(staticDir));

        deploymentApp.use((req: Request, res: Response, next) => {
            console.log(`📡 [${deploymentId}] ${req.method} ${req.path}`);
            next();
        });

        deploymentApp.get('*', (req: Request, res: Response) => {
            console.log(`🔄 [${deploymentId}] Serving SPA route: ${req.path}`);
            res.sendFile(path.join(staticDir, 'index.html'), {
                root: '/'
            });
        });

        const deploymentServer = createServer(deploymentApp);
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
        const deploymentInfo: DeploymentInfo = {
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
            app.use((req: Request, res: Response, next) => {
                const host = req.headers.host;
                if (host === `${customDomain}.localhost:3000`) {
                    // Proxy the request to the actual deployment port
                    const proxy = createProxyMiddleware({
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

    } catch (err: unknown) {
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
});

// Updated status endpoint to include logs
app.get('/deployment/:id', (req: Request, res: Response) => {
    const deployment = deployments.get(req.params.id);
    if (!deployment) {
        res.status(404).json({ error: 'Deployment not found' });
        return;
    }
    res.json(deployment);
});

httpServer.listen(3000, () => console.log('Server running on port 3000'));

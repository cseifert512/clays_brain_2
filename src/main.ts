import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
import { gsap } from 'gsap';
import type { EmbeddingItem, LayoutAlgorithm } from './types';

// Add this at the top of the file or in a types file if not present
// Vite provides import.meta.env, so we need to declare it for TypeScript
// If you already have this in types.ts, you can skip it

declare global {
  interface ImportMeta {
    env: {
      BASE_URL: string;
      [key: string]: any;
    };
  }
}

const IS_MOBILE = /Mobi|Android/i.test(navigator.userAgent) || window.innerWidth < 768;
const MAX_EMBEDDINGS_MOBILE = 1000; // Attempt to load all 1000 images on mobile with resizing
const MOBILE_TEXTURE_WIDTH = 256; // Target width for textures on mobile

let scene: THREE.Scene;
let camera: THREE.PerspectiveCamera;
let renderer: THREE.WebGLRenderer;
let controls: OrbitControls;
let loadedEmbeddings: EmbeddingItem[] = [];
let imageSprites: THREE.Sprite[] = [];
// const textureLoader = new THREE.TextureLoader(); // Not needed if using LoadingManager for all
let currentLayoutAlgorithm: LayoutAlgorithm = 'tsne'; // This might become less relevant if viz modes directly use specific data.
let currentVisualizationMode: '3d' | '2d-scatter' | '2d-grid' = '3d'; // New state for visualization mode

const clusterEpicenters: Map<string, THREE.Vector3> = new Map();
const itemsByCluster: Map<string, EmbeddingItem[]> = new Map();

let pcaMin: THREE.Vector3 | null = null;
let pcaMax: THREE.Vector3 | null = null;
let pcaRange: THREE.Vector3 | null = null;
const DESIRED_PCA_VISUAL_SPREAD = 100;

// For 3D t-SNE scatter plot
let tsne3dMin: THREE.Vector3 | null = null;
let tsne3dMax: THREE.Vector3 | null = null;
let tsne3dRange: THREE.Vector3 | null = null;
const DESIRED_TSNE3D_VISUAL_SPREAD = 100; // Initial value, can be tweaked
const CAMERA_3D_DISTANCE_FACTOR = 0.75; // Factor for camera distance in 3D mode

// For 2D t-SNE scatter plot
let tsne2dMin: THREE.Vector2 | null = null;
let tsne2dMax: THREE.Vector2 | null = null;
let tsne2dRange: THREE.Vector2 | null = null;
const DESIRED_TSNE2D_VISUAL_SPREAD = 300; // Visual spread for 2D t-SNE - Further Increased

// For 2D "grid" (now using tsne_2d_grid_snap data as indices)
let gridSnapMinCol: number = Infinity;
let gridSnapMaxCol: number = -Infinity;
let gridSnapMinRow: number = Infinity;
let gridSnapMaxRow: number = -Infinity;

const SPRITE_SCALE = 5; 
const GRID_CELL_SIZE = SPRITE_SCALE * 2.0; // Increased spacing for grid items (was 1.5)
const CLUSTER_EPICENTER_SPREAD = 50; 
const ITEMS_WITHIN_CLUSTER_SPREAD = 10; 

// Raycaster and mouse for interaction
const raycaster = new THREE.Raycaster();
const mouse = new THREE.Vector2();
let hoveredSprite: THREE.Sprite | null = null;
let selectedSprite: THREE.Sprite | null = null;
const MAX_SPRITE_SCREEN_SIZE = 0.4; // Max fraction of screen height/width

function onPointerMove(event: MouseEvent) {
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(imageSprites);
    if (intersects.length > 0) {
        const sprite = intersects[0].object as THREE.Sprite;
        if (hoveredSprite !== sprite) {
            if (hoveredSprite && hoveredSprite !== selectedSprite) {
                gsap.to(hoveredSprite.scale, { // Reset previous hover
                    x: hoveredSprite.userData.originalScale.x,
                    y: hoveredSprite.userData.originalScale.y,
                    z: hoveredSprite.userData.originalScale.z,
                    duration: 0.2
                });
            }
            hoveredSprite = sprite;
            if (hoveredSprite !== selectedSprite) {
                // Calculate max allowed scale based on screen size
                const dist = camera.position.distanceTo(hoveredSprite.position);
                const vFOV = THREE.MathUtils.degToRad(camera.fov);
                const screenHeight = 2 * Math.tan(vFOV / 2) * dist;
                const maxScale = screenHeight * MAX_SPRITE_SCREEN_SIZE;
                const aspect = hoveredSprite.scale.x / hoveredSprite.scale.y;
                const targetY = Math.min(maxScale, hoveredSprite.userData.originalScale.y * 2.5);
                const targetX = targetY * aspect;
                gsap.to(hoveredSprite.scale, {
                    x: targetX,
                    y: targetY,
                    z: 1,
                    duration: 0.2
                });
            }
        }
    } else {
        if (hoveredSprite && hoveredSprite !== selectedSprite) {
            gsap.to(hoveredSprite.scale, {
                x: hoveredSprite.userData.originalScale.x,
                y: hoveredSprite.userData.originalScale.y,
                z: hoveredSprite.userData.originalScale.z,
                duration: 0.2
            });
        }
        hoveredSprite = null;
    }
}

function onPointerDown(event: MouseEvent) {
    const canvas = renderer.domElement;
    const rect = canvas.getBoundingClientRect();
    mouse.x = ((event.clientX - rect.left) / rect.width) * 2 - 1;
    mouse.y = -((event.clientY - rect.top) / rect.height) * 2 + 1;

    raycaster.setFromCamera(mouse, camera);
    const intersects = raycaster.intersectObjects(imageSprites);
    if (intersects.length > 0) {
        const sprite = intersects[0].object as THREE.Sprite;
        if (selectedSprite && selectedSprite !== hoveredSprite) {
            // Reset previous selected
            gsap.to(selectedSprite.scale, {
                x: selectedSprite.userData.originalScale.x,
                y: selectedSprite.userData.originalScale.y,
                z: selectedSprite.userData.originalScale.z,
                duration: 0.2
            });
        }
        if (sprite) {
            selectedSprite = sprite;
            // Calculate max allowed scale based on screen size
            const dist = camera.position.distanceTo(selectedSprite!.position);
            const vFOV = THREE.MathUtils.degToRad(camera.fov);
            const screenHeight = 2 * Math.tan(vFOV / 2) * dist;
            const maxScale = screenHeight * MAX_SPRITE_SCREEN_SIZE;
            const aspect = selectedSprite!.scale.x / selectedSprite!.scale.y;
            const targetY = Math.min(maxScale, selectedSprite!.userData.originalScale.y * 2.5);
            const targetX = targetY * aspect;
            gsap.to(selectedSprite!.scale, {
                x: targetX,
                y: targetY,
                z: 1,
                duration: 0.3
            });
            // Animate camera and controls to focus on the sprite
            const coverage = 0.6; // 60% of screen
            const requiredDist = getCameraDistanceForScreenCoverage(selectedSprite!, coverage);
            // Find a camera position with no overlap
            const bestCamPos = findNonOverlappingCameraPosition(selectedSprite!, requiredDist, 36);
            gsap.to(camera.position, {
                x: bestCamPos.x,
                y: bestCamPos.y,
                z: bestCamPos.z,
                duration: 0.8,
                ease: 'power2.out',
                onUpdate: () => { camera.lookAt(selectedSprite!.position); }
            });
            gsap.to(controls.target, {
                x: selectedSprite!.position.x,
                y: selectedSprite!.position.y,
                z: selectedSprite!.position.z,
                duration: 0.8,
                ease: 'power2.out',
                onUpdate: () => { controls.update(); }
            });
        }
    }
}

// Attach event listeners after renderer is created
function enableSpriteInteraction() {
    const canvas = renderer.domElement;
    canvas.addEventListener('pointermove', onPointerMove);
    canvas.addEventListener('pointerdown', onPointerDown);
}

// This function will set up the basic Three.js environment
function initThreeApp() {
    scene = new THREE.Scene();
    scene.background = new THREE.Color(0xffffff); 

    camera = new THREE.PerspectiveCamera(75, window.innerWidth / window.innerHeight, 0.1, 1000);
    camera.position.z = 50;

    const canvas = document.getElementById('webgl-canvas') as HTMLCanvasElement;
    renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
    renderer.setSize(window.innerWidth, window.innerHeight);

    // Cap devicePixelRatio on mobile devices for performance
    renderer.setPixelRatio(IS_MOBILE ? Math.min(window.devicePixelRatio, 1.5) : window.devicePixelRatio);
    renderer.outputColorSpace = THREE.SRGBColorSpace; 

    controls = new OrbitControls(camera, renderer.domElement);
    controls.enableDamping = true;
    controls.dampingFactor = 0.05;
    controls.autoRotate = true; // Set autoRotate to true by default
    controls.autoRotateSpeed = 0.5;
    // controls.enableZoom = true; // Ensure zoom is enabled
    // controls.enablePan = true; // Ensure pan is enabled

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
    scene.add(ambientLight);
    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.5);
    directionalLight.position.set(5, 10, 7.5);
    scene.add(directionalLight);

    window.addEventListener('resize', onWindowResize);
    storeInitialState(); // Store initial state after setup
    // createResetButton(); // Moved to start button click handler
}

async function loadDataAndSetupUI() {
    try {
        // Use Vite's base URL for correct asset path in dev and production
        const response = await fetch(`${import.meta.env.BASE_URL}embeddings.json`);
        if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`);
        }
        loadedEmbeddings = await response.json();
        console.log(`Loaded ${loadedEmbeddings.length} embeddings initially.`);

        if (IS_MOBILE && loadedEmbeddings.length > MAX_EMBEDDINGS_MOBILE) {
            // Shuffle and take a subset to make it somewhat random and representative
            for (let i = loadedEmbeddings.length - 1; i > 0; i--) {
                const j = Math.floor(Math.random() * (i + 1));
                [loadedEmbeddings[i], loadedEmbeddings[j]] = [loadedEmbeddings[j], loadedEmbeddings[i]];
            }
            loadedEmbeddings = loadedEmbeddings.slice(0, MAX_EMBEDDINGS_MOBILE);
            console.log(`On mobile, reduced embeddings to ${loadedEmbeddings.length}`);
        }

        calculatePCABounds();
        calculateTsne3DBounds(); // For 3D Scatter
        calculateTsne2DBounds(); // For 2D Scatter
        calculateGridSnapBounds(); // For 2D Grid using tsne_2d_grid_snap
        createImageSprites(); // This starts the loading process via LoadingManager

        // const layoutSelect = document.getElementById('layout-algorithm') as HTMLSelectElement; // Removed as element no longer exists
        // if (layoutSelect) { // Added a null check for safety, though the block is removed
        //     layoutSelect.addEventListener('change', (event) => {
        //         currentLayoutAlgorithm = (event.target as HTMLSelectElement).value as LayoutAlgorithm;
        //         console.log(`Layout changed to: ${currentLayoutAlgorithm}`);
        //         if (['kmeans', 'dbscan', 'agglom'].includes(currentLayoutAlgorithm)) {
        //             let needsRecalculation = true;
        //             if (clusterEpicenters.size > 0) {
        //                 const firstKey = clusterEpicenters.keys().next().value;
        //                 if (firstKey && firstKey.startsWith(currentLayoutAlgorithm)) {
        //                     needsRecalculation = false;
        //                 }
        //             }
        //             if (needsRecalculation) {
        //                 calculateAndStoreClusterEpicenters(currentLayoutAlgorithm as 'kmeans' | 'dbscan' | 'agglom');
        //             }
        //         }
        //         updateSpritePositions();
        //     });
        // }

        const autoRotateCheckbox = document.getElementById('auto-rotate-toggle') as HTMLInputElement;
        if (autoRotateCheckbox) {
            autoRotateCheckbox.addEventListener('change', (event) => {
                if(controls) controls.autoRotate = (event.target as HTMLInputElement).checked;
            });
        }

        // Event listeners for the new visualization toggle
        const vizRadios = document.querySelectorAll<HTMLInputElement>('input[name="visualization"]');
        vizRadios.forEach(radio => {
            radio.addEventListener('change', () => {
                currentVisualizationMode = radio.value as '3d' | '2d-scatter' | '2d-grid';
                console.log(`Visualization mode changed to: ${currentVisualizationMode}`);
                // Adjust camera and controls for the new mode
                adjustCameraForMode(currentVisualizationMode);
                // Trigger animation to new positions
                updateSpritePositions(true); // Pass true to indicate animation
            });
        });
        
        // Initial camera adjustment
        adjustCameraForMode(currentVisualizationMode);

    } catch (error) {
        console.error("Failed to load or process embeddings.json:", error);
        const modalText = document.querySelector('#preloader-modal h1');
        if (modalText) {
            modalText.textContent = `Error loading data. Check console.`;
            modalText.parentElement?.querySelector('.loading-bar-container')?.remove();
        }
    }
}

function createImageSprites() {
    imageSprites.forEach(sprite => scene.remove(sprite)); // Clear existing sprites if any
    imageSprites = [];

    if (loadedEmbeddings.length === 0) {
        // Handle case where embeddings might be empty after filtering or error
        const startButton = document.getElementById('start-button');
        const loadingBarContainer = document.querySelector('.loading-bar-container');
        if (loadingBarContainer) (loadingBarContainer as HTMLElement).style.display = 'none';
        if (startButton) startButton.style.display = 'inline'; // Allow starting even if no images
        return;
    }

    const loadingManager = new THREE.LoadingManager();
    const localTextureLoader = new THREE.TextureLoader(loadingManager);

    loadingManager.onProgress = (url, itemsLoaded, itemsTotal) => {
        const progress = (itemsLoaded / itemsTotal) * 100;
        const loadingBarFill = document.getElementById('loading-bar-fill');
        if (loadingBarFill) {
            loadingBarFill.style.width = `${progress}%`;
        }
    };

    loadingManager.onLoad = () => {
        console.log("All textures loaded (or attempted).");
        const loadingBarContainer = document.querySelector('.loading-bar-container');
        if (loadingBarContainer) (loadingBarContainer as HTMLElement).style.display = 'none';
        
        if (['kmeans', 'dbscan', 'agglom'].includes(currentLayoutAlgorithm)) { // This clustering logic might need to be re-evaluated with new viz modes
            calculateAndStoreClusterEpicenters(currentLayoutAlgorithm as 'kmeans' | 'dbscan' | 'agglom');
        }
        updateSpritePositions(false); // Initial positioning without animation

        if (renderer && scene && camera) {
            renderer.render(scene, camera); // Pre-render the scene
        }
        
        const startButton = document.getElementById('start-button');
        if (startButton) startButton.style.display = 'inline';
    };

    loadingManager.onError = (url) => { 
        console.error(`There was an error loading texture: ${url}`);
    };
    
    const cloudName = 'dhivyxaxy';
    // Remove the version part entirely
    // const imageVersionPath = ''; // No longer needed

    loadedEmbeddings.forEach((item, index) => {
        const filenameWithoutExtension = item.filename.substring(0, item.filename.lastIndexOf('.'));
        let imageUrl = '';

        if (IS_MOBILE) {
            // Construct URL with width transformation for mobile, no version
            imageUrl = `https://res.cloudinary.com/${cloudName}/image/upload/w_${MOBILE_TEXTURE_WIDTH}/${filenameWithoutExtension}.png`;
        } else {
            // Original URL for desktop, no version
            imageUrl = `https://res.cloudinary.com/${cloudName}/image/upload/${filenameWithoutExtension}.png`;
        }
        // console.log(`Loading image: ${imageUrl}`); // For debugging

        localTextureLoader.load(
            imageUrl,
            (texture) => {
                texture.colorSpace = THREE.SRGBColorSpace; 
                const material = new THREE.SpriteMaterial({ map: texture, transparent: true, alphaTest: 0.1 });
                const sprite = new THREE.Sprite(material);
                const aspectRatio = texture.image.width / texture.image.height;
                sprite.scale.set(SPRITE_SCALE * aspectRatio, SPRITE_SCALE, 1);
                sprite.userData = { id: index, embeddingItem: item, originalScale: sprite.scale.clone() };
                imageSprites.push(sprite);
                scene.add(sprite);
            },
            undefined, 
            (error) => { 
                console.error(`Failed to load texture for ${item.filename}:`, error);
            }
        );
    });
    enableSpriteInteraction();
}

function calculatePCABounds() {
    if (loadedEmbeddings.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const item of loadedEmbeddings) {
        minX = Math.min(minX, item.pca[0]); maxX = Math.max(maxX, item.pca[0]);
        minY = Math.min(minY, item.pca[1]); maxY = Math.max(maxY, item.pca[1]);
        minZ = Math.min(minZ, item.pca[2]); maxZ = Math.max(maxZ, item.pca[2]);
    }
    pcaMin = new THREE.Vector3(minX, minY, minZ);
    pcaMax = new THREE.Vector3(maxX, maxY, maxZ);
    let rangeX = maxX - minX; let rangeY = maxY - minY; let rangeZ = maxZ - minZ;
    if (rangeX === 0) rangeX = 1; if (rangeY === 0) rangeY = 1; if (rangeZ === 0) rangeZ = 1; // Avoid division by zero
    pcaRange = new THREE.Vector3(rangeX, rangeY, rangeZ);
}

function calculateTsne2DBounds() {
    if (loadedEmbeddings.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity;
    for (const item of loadedEmbeddings) {
        if (item.tsne_2d) { // Ensure tsne_2d data exists
            minX = Math.min(minX, item.tsne_2d[0]); maxX = Math.max(maxX, item.tsne_2d[0]);
            minY = Math.min(minY, item.tsne_2d[1]); maxY = Math.max(maxY, item.tsne_2d[1]);
        }
    }
    tsne2dMin = new THREE.Vector2(minX, minY);
    tsne2dMax = new THREE.Vector2(maxX, maxY);
    let rangeX = maxX - minX; let rangeY = maxY - minY;
    if (rangeX === 0) rangeX = 1; if (rangeY === 0) rangeY = 1; // Avoid division by zero
    tsne2dRange = new THREE.Vector2(rangeX, rangeY);
}

function calculateTsne3DBounds() {
    if (loadedEmbeddings.length === 0) return;
    let minX = Infinity, maxX = -Infinity, minY = Infinity, maxY = -Infinity, minZ = Infinity, maxZ = -Infinity;
    for (const item of loadedEmbeddings) {
        if (item.tsne) { // Ensure tsne data exists (it's 3D)
            minX = Math.min(minX, item.tsne[0]); maxX = Math.max(maxX, item.tsne[0]);
            minY = Math.min(minY, item.tsne[1]); maxY = Math.max(maxY, item.tsne[1]);
            minZ = Math.min(minZ, item.tsne[2]); maxZ = Math.max(maxZ, item.tsne[2]);
        }
    }
    tsne3dMin = new THREE.Vector3(minX, minY, minZ);
    tsne3dMax = new THREE.Vector3(maxX, maxY, maxZ);
    let rangeX = maxX - minX; let rangeY = maxY - minY; let rangeZ = maxZ - minZ;
    if (rangeX === 0) rangeX = 1; if (rangeY === 0) rangeY = 1; if (rangeZ === 0) rangeZ = 1;
    tsne3dRange = new THREE.Vector3(rangeX, rangeY, rangeZ);
}

function calculateGridSnapBounds() { // For tsne_2d_grid_snap data
    if (loadedEmbeddings.length === 0) return;
    // Reset before calculation
    gridSnapMinCol = Infinity; gridSnapMaxCol = -Infinity;
    gridSnapMinRow = Infinity; gridSnapMaxRow = -Infinity;

    for (const item of loadedEmbeddings) {
        if (item.tsne_2d_grid_snap) { // Use the new field
            gridSnapMinCol = Math.min(gridSnapMinCol, item.tsne_2d_grid_snap[0]);
            gridSnapMaxCol = Math.max(gridSnapMaxCol, item.tsne_2d_grid_snap[0]);
            gridSnapMinRow = Math.min(gridSnapMinRow, item.tsne_2d_grid_snap[1]);
            gridSnapMaxRow = Math.max(gridSnapMaxRow, item.tsne_2d_grid_snap[1]);
        }
    }
    // Check if any valid grid snap coordinates were found
    if (!isFinite(gridSnapMinCol)) {
        console.warn("No valid tsne_2d_grid_snap data found to calculate grid bounds.");
        // Set defaults to prevent NaN issues if this mode is selected with no data
        gridSnapMinCol = 0; gridSnapMaxCol = 0; gridSnapMinRow = 0; gridSnapMaxRow = 0;
    }
}


function calculateAndStoreClusterEpicenters(algorithm: 'kmeans' | 'dbscan' | 'agglom') {
    clusterEpicenters.clear(); itemsByCluster.clear();
    const uniqueClusterIds = new Set<number>();
    loadedEmbeddings.forEach(item => { uniqueClusterIds.add(item[algorithm as 'cluster_kmeans']); });
    const sortedClusterIds = Array.from(uniqueClusterIds).sort((a, b) => a - b);
    const numClusters = sortedClusterIds.length;
    const gridSize = Math.ceil(Math.sqrt(numClusters));
    sortedClusterIds.forEach((clusterId, index) => {
        const key = `${algorithm}_${clusterId}`;
        const x = (index % gridSize - (gridSize -1) / 2) * CLUSTER_EPICENTER_SPREAD;
        const y = (Math.floor(index / gridSize) - (gridSize-1) / 2) * CLUSTER_EPICENTER_SPREAD;
        clusterEpicenters.set(key, new THREE.Vector3(x, y, 0));
        const itemsInThisCluster = loadedEmbeddings.filter(item => item[algorithm as 'cluster_kmeans'] === clusterId);
        itemsByCluster.set(key, itemsInThisCluster);
    });
}

function getPositionInCluster(basePosition: THREE.Vector3, itemIndexInCluster: number, totalItemsInCluster: number): THREE.Vector3 {
    const n = totalItemsInCluster; const i = itemIndexInCluster;
    const phi = Math.acos(1 - 2 * (i + 0.5) / n); 
    const theta = Math.PI * (1 + Math.sqrt(5)) * (i + 0.5); 
    const x = ITEMS_WITHIN_CLUSTER_SPREAD * Math.sin(phi) * Math.cos(theta);
    const y = ITEMS_WITHIN_CLUSTER_SPREAD * Math.sin(phi) * Math.sin(theta);
    const z = ITEMS_WITHIN_CLUSTER_SPREAD * Math.cos(phi);
    return new THREE.Vector3(basePosition.x + x, basePosition.y + y, basePosition.z + z);
}

// const GRID_CELL_SIZE = SPRITE_SCALE * 1.2; // REMOVED DUPLICATE

function updateSpritePositions(animateTransition = false) {
    if (imageSprites.length === 0 && loadedEmbeddings.length > 0 && !document.getElementById('start-button')?.style.display.includes('inline')) { 
        console.log("updateSpritePositions: Sprites not ready or loading not complete.");
        return; 
    }

    imageSprites.forEach((sprite) => {
        const item = sprite.userData.embeddingItem as EmbeddingItem;
        if (!item) { return; }

        let targetPosition: THREE.Vector3;

        switch (currentVisualizationMode) {
            case '3d':
                // Use existing layout algorithm for 3D positions (tsne, pca, clusters)
                // This part might need to be merged with the old switch(currentLayoutAlgorithm) logic
                // For now, let's default to 'tsne' for 3D if no other layout is selected.
                if (item.tsne && tsne3dMin && tsne3dRange && tsne3dRange.x !== 0 && tsne3dRange.y !== 0 && tsne3dRange.z !== 0) {
                    const normX = (item.tsne[0] - tsne3dMin.x) / tsne3dRange.x;
                    const normY = (item.tsne[1] - tsne3dMin.y) / tsne3dRange.y;
                    const normZ = (item.tsne[2] - tsne3dMin.z) / tsne3dRange.z;
                    targetPosition = new THREE.Vector3(
                        (normX - 0.5) * DESIRED_TSNE3D_VISUAL_SPREAD,
                        (normY - 0.5) * DESIRED_TSNE3D_VISUAL_SPREAD,
                        (normZ - 0.5) * DESIRED_TSNE3D_VISUAL_SPREAD
                    );
                } else if (item.tsne) { // Fallback if bounds not ready
                    targetPosition = new THREE.Vector3(...item.tsne);
                } else {
                    targetPosition = new THREE.Vector3(0,0,0); // Fallback
                }
                break;
            case '2d-scatter':
                if (item.tsne_2d && tsne2dMin && tsne2dRange && tsne2dRange.x !== 0 && tsne2dRange.y !== 0) {
                    const normX = (item.tsne_2d[0] - tsne2dMin.x) / tsne2dRange.x;
                    const normY = (item.tsne_2d[1] - tsne2dMin.y) / tsne2dRange.y;
                    targetPosition = new THREE.Vector3(
                        (normX - 0.5) * DESIRED_TSNE2D_VISUAL_SPREAD,
                        (normY - 0.5) * DESIRED_TSNE2D_VISUAL_SPREAD,
                        (Math.random() - 0.5) * 2.0 // Significantly Increased random Z to prevent Z-fighting
                    );
                } else if (item.tsne_2d) { // Fallback if bounds are not ready or range is zero
                    targetPosition = new THREE.Vector3(item.tsne_2d[0], item.tsne_2d[1], 0); // Use raw if no bounds
                } else {
                    targetPosition = new THREE.Vector3(0,0,0); // Fallback if no tsne_2d data
                }
                break;
            case '2d-grid':
                if (item.tsne_2d_grid_snap && 
                    isFinite(gridSnapMinCol) && isFinite(gridSnapMaxCol) && 
                    isFinite(gridSnapMinRow) && isFinite(gridSnapMaxRow)) {
                    
                    const numCols = gridSnapMaxCol - gridSnapMinCol + 1;
                    const numRows = gridSnapMaxRow - gridSnapMinRow + 1;

                    const gridWidth = numCols * GRID_CELL_SIZE;
                    const gridHeight = numRows * GRID_CELL_SIZE;

                    // Calculate position relative to the top-left of the actual data's grid extent
                    const col = item.tsne_2d_grid_snap[0];
                    const row = item.tsne_2d_grid_snap[1];
                    
                    const x = (col - gridSnapMinCol) * GRID_CELL_SIZE;
                    const y = (row - gridSnapMinRow) * GRID_CELL_SIZE;

                    // Calculate a small, unique Z-offset for each grid item
                    const zDeterministicOffset = ((row - gridSnapMinRow) * numCols + (col - gridSnapMinCol)) * 0.0001;

                    // Offset to center the entire grid
                    targetPosition = new THREE.Vector3(
                        x - (gridWidth / 2) + (GRID_CELL_SIZE / 2),
                        -y + (gridHeight / 2) - (GRID_CELL_SIZE / 2), // Use -y to make row 0 at top
                        zDeterministicOffset 
                    );
                } else {
                    targetPosition = new THREE.Vector3(0,0,0); // Fallback
                }
                break;
            default:
                targetPosition = new THREE.Vector3(0,0,0);
        }

        if (animateTransition) {
            gsap.to(sprite.position, {
                x: targetPosition.x,
                y: targetPosition.y,
                z: targetPosition.z,
                duration: 0.8, // Animation duration in seconds
                ease: 'power2.out' // Easing function
            });
        } else {
            sprite.position.copy(targetPosition);
        }
    });
}

function getCameraDistanceForScreenCoverage(sprite: THREE.Sprite, coverage: number) {
    // Get the sprite's world scale
    const worldScale = new THREE.Vector3();
    sprite.getWorldScale(worldScale);
    // Get the aspect ratio of the canvas
    const canvas = renderer.domElement;
    const aspect = canvas.width / canvas.height;
    // Sprite size in world units
    const spriteWidth = worldScale.x;
    const spriteHeight = worldScale.y;
    // Camera FOV is vertical
    // For height: h = 2 * d * tan(fov/2) => d = h / (2 * tan(fov/2))
    const vFOV = THREE.MathUtils.degToRad(camera.fov);
    const requiredDistForHeight = spriteHeight / (2 * coverage * Math.tan(vFOV / 2));
    // For width: w = 2 * d * tan(fov/2) * aspect => d = w / (2 * coverage * tan(fov/2) * aspect)
    const requiredDistForWidth = spriteWidth / (2 * coverage * Math.tan(vFOV / 2) * aspect);
    // Use the larger required distance (whichever is more limiting)
    return Math.max(requiredDistForHeight, requiredDistForWidth);
}

function getSpriteFrontDirection(sprite: THREE.Sprite): THREE.Vector3 {
    // Sprites in Three.js always face the camera, so use camera-to-sprite direction
    // We'll use the current camera position to determine the direction
    const dir = new THREE.Vector3();
    dir.subVectors(camera.position, sprite.position).normalize();
    return dir;
}

function bringSpriteForward(sprite: THREE.Sprite, offset = 0.1) {
    // Move the sprite slightly forward along the camera-to-sprite direction
    const dir = getSpriteFrontDirection(sprite);
    sprite.position.addScaledVector(dir, -offset); // Move toward camera
}

function spritesOverlapOnScreen(spriteA: THREE.Sprite, spriteB: THREE.Sprite): boolean {
    // Project both sprite centers to screen space
    const width = renderer.domElement.width;
    const height = renderer.domElement.height;
    const projA = spriteA.position.clone().project(camera);
    const projB = spriteB.position.clone().project(camera);
    // Get world scale for each sprite
    const scaleA = new THREE.Vector3(); spriteA.getWorldScale(scaleA);
    const scaleB = new THREE.Vector3(); spriteB.getWorldScale(scaleB);
    // Estimate screen-space size (height in NDC * screen height)
    const spriteAScreenH = scaleA.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * height / camera.position.distanceTo(spriteA.position);
    const spriteBScreenH = scaleB.y / (2 * Math.tan(THREE.MathUtils.degToRad(camera.fov) / 2)) * height / camera.position.distanceTo(spriteB.position);
    // Use a simple bounding box around the center
    const ax = (projA.x * 0.5 + 0.5) * width;
    const ay = (projA.y * -0.5 + 0.5) * height;
    const bx = (projB.x * 0.5 + 0.5) * width;
    const by = (projB.y * -0.5 + 0.5) * height;
    // Rectangle: center +/- half height (approximate as square)
    const aRect = {left: ax - spriteAScreenH/2, right: ax + spriteAScreenH/2, top: ay - spriteAScreenH/2, bottom: ay + spriteAScreenH/2};
    const bRect = {left: bx - spriteBScreenH/2, right: bx + spriteBScreenH/2, top: by - spriteBScreenH/2, bottom: by + spriteBScreenH/2};
    // Check for overlap
    return !(aRect.right < bRect.left || aRect.left > bRect.right || aRect.bottom < bRect.top || aRect.top > bRect.bottom);
}

function findNonOverlappingCameraPosition(targetSprite: THREE.Sprite, requiredDist: number, steps = 36): THREE.Vector3 {
    // Try camera positions every 10 degrees around the sprite in XY and XZ planes
    let bestPos = null;
    let minOverlaps = Infinity;
    // First: XY plane
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const camPos = new THREE.Vector3(
            targetSprite.position.x + requiredDist * Math.cos(angle),
            targetSprite.position.y + requiredDist * Math.sin(angle),
            targetSprite.position.z
        );
        camera.position.copy(camPos);
        camera.lookAt(targetSprite.position);
        let overlaps = 0;
        for (const other of imageSprites) {
            if (other !== targetSprite && spritesOverlapOnScreen(targetSprite, other)) {
                overlaps++;
            }
        }
        if (overlaps === 0) {
            return camPos.clone();
        }
        if (overlaps < minOverlaps) {
            minOverlaps = overlaps;
            bestPos = camPos.clone();
        }
    }
    // Second: XZ plane (vertical orbit)
    for (let i = 0; i < steps; i++) {
        const angle = (i / steps) * Math.PI * 2;
        const camPos = new THREE.Vector3(
            targetSprite.position.x + requiredDist * Math.cos(angle),
            targetSprite.position.y,
            targetSprite.position.z + requiredDist * Math.sin(angle)
        );
        camera.position.copy(camPos);
        camera.lookAt(targetSprite.position);
        let overlaps = 0;
        for (const other of imageSprites) {
            if (other !== targetSprite && spritesOverlapOnScreen(targetSprite, other)) {
                overlaps++;
            }
        }
        if (overlaps === 0) {
            return camPos.clone();
        }
        if (overlaps < minOverlaps) {
            minOverlaps = overlaps;
            bestPos = camPos.clone();
        }
    }
    // If no perfect spot, return the one with the least overlap
    return bestPos || camera.position.clone();
}

function adjustCameraForMode(mode: '3d' | '2d-scatter' | '2d-grid') {
    if (!camera || !controls) return;

    const orbitToggleContainer = document.querySelector('.toggle-switch') as HTMLElement | null;
    const autoRotateCheckbox = document.getElementById('auto-rotate-toggle') as HTMLInputElement | null;

    // Common settings for 2D modes
    if (mode === '2d-scatter' || mode === '2d-grid') {
        // Determine appropriate Z based on content spread for the current 2D mode
        let cameraZ = 100; // Default for 2D
        if (mode === '2d-scatter' && DESIRED_TSNE2D_VISUAL_SPREAD > 0) {
            cameraZ = DESIRED_TSNE2D_VISUAL_SPREAD * 0.75; 
        } else if (mode === '2d-grid' && isFinite(gridSnapMinCol)) { // Use calculated bounds for grid
            const numCols = gridSnapMaxCol - gridSnapMinCol + 1;
            const numRows = gridSnapMaxRow - gridSnapMinRow + 1;
            const gridWidth = numCols * GRID_CELL_SIZE;
            const gridHeight = numRows * GRID_CELL_SIZE;
            
            const effectiveSpread = Math.max(gridWidth, gridHeight);
            if (effectiveSpread > 0) {
                 // Simplified: aim to fit the larger dimension in view, considering FOV.
                cameraZ = (effectiveSpread / 2) / Math.tan(THREE.MathUtils.degToRad(camera.fov / 2));
                cameraZ = Math.max(cameraZ * 1.1, 50); // Add some padding and ensure min distance
            } else {
                cameraZ = 100; // Fallback if grid is empty or has no size
            }
        }


        gsap.to(camera.position, {
            x: 0, 
            y: 0, 
            z: Math.max(cameraZ, 50), // Ensure a minimum distance, adjust Z based on content
            duration: 0.8,
            ease: 'power2.out',
            onUpdate: () => camera.lookAt(0,0,0) 
        });
        gsap.to(controls.target, {
            x:0, y:0, z:0,
            duration: 0.8,
            ease: 'power2.out'
        });
        controls.enableRotate = false; // Disable rotation for 2D views
        controls.autoRotate = false;   // Ensure auto-rotation is off
        if (autoRotateCheckbox) autoRotateCheckbox.checked = false;
        if (orbitToggleContainer) orbitToggleContainer.style.display = 'none';

        // Change mouse buttons for 2D: Left = PAN
        controls.mouseButtons.LEFT = THREE.MOUSE.PAN;
        controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY; 
        controls.mouseButtons.RIGHT = THREE.MOUSE.ROTATE; // Effectively disabled by enableRotate = false

        controls.touches.ONE = THREE.TOUCH.PAN;
        controls.touches.TWO = THREE.TOUCH.DOLLY_PAN; // Standard pinch zoom/pan

        // Consider enabling pan more freely for 2D:
        // controls.minPolarAngle = Math.PI / 2; 
        // controls.maxPolarAngle = Math.PI / 2;
        // controls.minAzimuthAngle = 0;
        // controls.maxAzimuthAngle = 0;

    } else { // 3D mode
        gsap.to(camera.position, {
            x: 0, 
            y: 0, 
            z: DESIRED_TSNE3D_VISUAL_SPREAD * CAMERA_3D_DISTANCE_FACTOR, // Adjust camera based on 3D spread and factor
            duration: 0.8,
            ease: 'power2.out',
            onUpdate: () => camera.lookAt(0,0,0)
        });
         gsap.to(controls.target, {
            x:0, y:0, z:0,
            duration: 0.8,
            ease: 'power2.out'
        });
        controls.enableRotate = true;
        if (orbitToggleContainer) orbitToggleContainer.style.display = 'inline-block'; // Or 'block' or original style
        
        // Reset mouse buttons for 3D: Left = ROTATE, Right = PAN
        controls.mouseButtons.LEFT = THREE.MOUSE.ROTATE;
        controls.mouseButtons.MIDDLE = THREE.MOUSE.DOLLY;
        controls.mouseButtons.RIGHT = THREE.MOUSE.PAN;

        controls.touches.ONE = THREE.TOUCH.ROTATE;
        controls.touches.TWO = THREE.TOUCH.DOLLY_PAN; // Standard pinch zoom/rotate

        // Restore checkbox state based on controls.autoRotate if needed, or leave as is
        // Reset polar/azimuth angle constraints if they were set for 2D
        // controls.minPolarAngle = 0; 
        // controls.maxPolarAngle = Math.PI;
        // controls.minAzimuthAngle = -Infinity;
        // controls.maxAzimuthAngle = Infinity;
    }
    controls.update();
}

// Store initial camera and controls state for reset functionality
let initialCameraPosition: THREE.Vector3;
let initialControlsTarget: THREE.Vector3;
let initialCameraFOV: number;

function storeInitialState() {
    initialCameraPosition = camera.position.clone();
    initialControlsTarget = controls.target.clone();
    initialCameraFOV = camera.fov;
}

function resetToInitialState() {
    // Reset camera and controls
    gsap.to(camera.position, {
        x: initialCameraPosition.x,
        y: initialCameraPosition.y,
        z: initialCameraPosition.z,
        duration: 0.8,
        ease: 'power2.out'
    });
    gsap.to(controls.target, {
        x: initialControlsTarget.x,
        y: initialControlsTarget.y,
        z: initialControlsTarget.z,
        duration: 0.8,
        ease: 'power2.out',
        onUpdate: () => { controls.update(); }
    });
    gsap.to(camera, {
        fov: initialCameraFOV,
        duration: 0.8,
        ease: 'power2.out',
        onUpdate: () => { camera.updateProjectionMatrix(); }
    });
    
    // Reset any selected or hovered sprites
    if (selectedSprite) {
        gsap.to(selectedSprite.scale, {
            x: selectedSprite.userData.originalScale.x,
            y: selectedSprite.userData.originalScale.y,
            z: selectedSprite.userData.originalScale.z,
            duration: 0.3
        });
        selectedSprite = null;
    }
    if (hoveredSprite) {
        gsap.to(hoveredSprite.scale, {
            x: hoveredSprite.userData.originalScale.x,
            y: hoveredSprite.userData.originalScale.y,
            z: hoveredSprite.userData.originalScale.z,
            duration: 0.3
        });
        hoveredSprite = null;
    }
}

function createResetButton() {
    const resetButton = document.createElement('button');
    resetButton.textContent = 'Reset View';
    resetButton.style.position = 'absolute';
    resetButton.style.top = '20px';
    resetButton.style.right = '20px';
    resetButton.style.zIndex = '1000';
    resetButton.style.padding = '8px 15px';
    resetButton.style.backgroundColor = '#f0f0f0';
    resetButton.style.border = '1px solid #ccc';
    resetButton.style.borderRadius = '18px';
    resetButton.style.cursor = 'pointer';
    resetButton.style.fontSize = '0.9em';
    resetButton.style.fontFamily = "'Space Grotesk', sans-serif";
    resetButton.style.color = '#333';
    resetButton.style.transition = 'background-color 0.3s, color 0.3s';
    resetButton.style.boxShadow = 'none';
    
    // Add hover effect to match the visualization toggle buttons
    resetButton.addEventListener('mouseenter', () => {
        resetButton.style.backgroundColor = '#ddd';
    });
    resetButton.addEventListener('mouseleave', () => {
        resetButton.style.backgroundColor = '#f0f0f0';
    });
    
    resetButton.addEventListener('click', resetToInitialState);
    
    document.body.appendChild(resetButton);
}


function onWindowResize() {
    if (camera && renderer) {
        camera.aspect = window.innerWidth / window.innerHeight;
        camera.updateProjectionMatrix();
        renderer.setSize(window.innerWidth, window.innerHeight);
    }
}

let animationFrameId: number | null = null;
function animate() {
    animationFrameId = requestAnimationFrame(animate);
    if (controls) controls.update(); 
    
    imageSprites.forEach(sprite => {
        if (sprite.material instanceof THREE.SpriteMaterial) {
            sprite.material.opacity = 1.0; 
        }
    });
    if (renderer && scene && camera) {
        renderer.render(scene, camera);
    }
}

function setupPreloader() {
    const modal = document.getElementById('preloader-modal');
    const startButton = document.getElementById('start-button');
    
    if (!modal || !startButton) {
        console.error("Preloader elements not found! Attempting to start app directly.");
        initThreeApp(); 
        loadDataAndSetupUI(); 
        animate();
        return;
    }
    
    initThreeApp(); 
    loadDataAndSetupUI(); 

    startButton.addEventListener('click', () => {
        gsap.to(modal, { 
            opacity: 0, 
            duration: 0.5, 
            onComplete: () => {
                modal.style.display = 'none';
                if (controls) { 
                    controls.target.set(0,0,0); 
                    controls.update();
                }
                if (animationFrameId === null) { 
                    animate(); 
                }
                const viewControls = document.querySelector('.view-controls') as HTMLElement | null;
                if (viewControls) {
                    viewControls.style.display = 'flex'; // Show the controls
                }
                createResetButton(); // Create the reset button after modal disappears
            }
        });
    });
}

// Start the application by setting up the preloader
setupPreloader();

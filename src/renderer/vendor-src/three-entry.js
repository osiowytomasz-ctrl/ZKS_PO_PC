// Wejście do paczki three.js (WebGL) dla podglądu 3D narzędzi – budowane do src/renderer/vendor/three.js poleceniem `npm run vendor:three`.
export {
  WebGLRenderer, Scene, PerspectiveCamera, Group, Mesh, LineSegments, BufferGeometry, BufferAttribute, LatheGeometry, ExtrudeGeometry, Shape, Vector2, Vector3, Box3,
  MeshStandardMaterial, LineBasicMaterial, EdgesGeometry, AmbientLight, HemisphereLight, DirectionalLight, GridHelper, AxesHelper, Color, DoubleSide, SRGBColorSpace, ACESFilmicToneMapping, PMREMGenerator,
} from 'three';
export { OrbitControls } from 'three/examples/jsm/controls/OrbitControls.js';
export { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js';

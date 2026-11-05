import { useMemo, useRef, useState } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { Html, Line, OrbitControls, PerspectiveCamera, Stars } from '@react-three/drei';
import * as THREE from 'three';

const buildings = Array.from({ length: 64 }, (_, i) => {
  const col = i % 8;
  const row = Math.floor(i / 8);
  const seed = Math.abs(Math.sin((i + 4) * 91.71));
  const x = (col - 3.5) * 1.65 + (row % 2 ? 0.22 : -0.15);
  const z = (row - 3.5) * 1.55;
  const h = 0.55 + seed * 2.7;
  const w = 0.42 + (seed * 0.2);
  return { x, z, h, w, seed, id: i };
});

function Building({ item, heat, heatLevel }: { item: (typeof buildings)[number]; heat: boolean; heatLevel: number }) {
  const color = heat && item.seed > 0.65 ? '#a54b32' : item.seed > 0.76 ? '#426e64' : '#173c38';
  return (
    <group position={[item.x, 0, item.z]}>
      <mesh position={[0, item.h / 2, 0]} castShadow receiveShadow>
        <boxGeometry args={[item.w, item.h, item.w]} />
        <meshStandardMaterial color={color} metalness={0.28} roughness={0.42} emissive={heat && item.seed > 0.65 ? '#9c3c19' : '#08231f'} emissiveIntensity={heat && item.seed > 0.65 ? 0.12 + heatLevel * 0.42 : 0.12} />
      </mesh>
      <mesh position={[0, item.h + 0.025, 0]}>
        <boxGeometry args={[item.w * 1.08, 0.05, item.w * 1.08]} />
        <meshStandardMaterial color={heat && item.seed > 0.65 ? '#ff9c62' : '#64d8b0'} emissive={heat && item.seed > 0.65 ? '#ff6b32' : '#2cbd91'} emissiveIntensity={0.55} />
      </mesh>
      {Array.from({ length: Math.max(1, Math.floor(item.h * 1.4)) }, (_, j) => (
        <mesh key={j} position={[0, 0.22 + j * 0.28, item.w / 2 + 0.006]}>
          <planeGeometry args={[item.w * 0.36, 0.07]} />
          <meshBasicMaterial color={heat && item.seed > 0.65 ? '#ffb071' : '#7be9d2'} transparent opacity={0.72} />
        </mesh>
      ))}
    </group>
  );
}

function Tree({ x, z, scale = 1 }: { x: number; z: number; scale?: number }) {
  return (
    <group position={[x, 0, z]} scale={scale}>
      <mesh position={[0, 0.22, 0]} castShadow>
        <cylinderGeometry args={[0.045, 0.07, 0.45, 6]} />
        <meshStandardMaterial color="#8a7553" />
      </mesh>
      <mesh position={[0, 0.58, 0]} castShadow>
        <icosahedronGeometry args={[0.28, 1]} />
        <meshStandardMaterial color="#3fc49a" roughness={0.8} emissive="#0e604a" emissiveIntensity={0.3} />
      </mesh>
    </group>
  );
}

function RoutePulse({ curve }: { curve: THREE.CatmullRomCurve3 }) {
  const ref = useRef<THREE.Mesh>(null);
  useFrame(({ clock }) => {
    if (!ref.current) return;
    const p = curve.getPoint((clock.getElapsedTime() * 0.075) % 1);
    ref.current.position.copy(p);
  });
  return (
    <mesh ref={ref}>
      <sphereGeometry args={[0.105, 18, 18]} />
      <meshBasicMaterial color="#c9fff0" />
    </mesh>
  );
}

function HeatVolumes({ visible, heatLevel }: { visible: boolean; heatLevel: number }) {
  const group = useRef<THREE.Group>(null);
  useFrame(({ clock }) => {
    if (group.current) group.current.children.forEach((child, i) => { child.scale.y = 0.85 + Math.sin(clock.elapsedTime * 1.3 + i) * 0.08; });
  });
  if (!visible) return null;
  return (
    <group ref={group}>
      {[
        { x: -4.3, z: 2.2, color: '#ff683e', s: 1.6 },
        { x: 3.8, z: -2.6, color: '#ff9b45', s: 1.2 },
        { x: 0.2, z: 4.1, color: '#ffcf65', s: 1.1 },
      ].map((v, i) => (
        <mesh key={i} position={[v.x, 0.08, v.z]} rotation={[-Math.PI / 2, 0, 0]}>
          <circleGeometry args={[v.s, 48]} />
          <meshBasicMaterial color={v.color} transparent opacity={0.06 + heatLevel * 0.17} depthWrite={false} />
        </mesh>
      ))}
      {[
        [-4.3, 0.7, 2.2, '#ff6338'], [3.8, 0.5, -2.6, '#ff9b45'], [0.2, 0.45, 4.1, '#ffcc64'],
      ].map(([x, y, z, color], i) => (
        <mesh key={`dome-${i}`} position={[Number(x), Number(y), Number(z)]}>
          <sphereGeometry args={[i === 0 ? 1.35 : 1.05, 28, 18]} />
          <meshBasicMaterial color={String(color)} transparent opacity={0.035 + heatLevel * 0.09} wireframe depthWrite={false} />
        </mesh>
      ))}
    </group>
  );
}

function AirParticles({ visible }: { visible: boolean }) {
  const points = useRef<THREE.Points>(null);
  const positions = useMemo(() => {
    const data = new Float32Array(420 * 3);
    for (let i = 0; i < 420; i++) {
      data[i * 3] = (Math.random() - 0.5) * 18;
      data[i * 3 + 1] = Math.random() * 4 + 0.4;
      data[i * 3 + 2] = (Math.random() - 0.5) * 18;
    }
    return data;
  }, []);
  useFrame((_, delta) => {
    if (points.current) points.current.rotation.y += delta * 0.025;
  });
  if (!visible) return null;
  return <points ref={points}>
    <bufferGeometry><bufferAttribute attach="attributes-position" args={[positions, 3]} /></bufferGeometry>
    <pointsMaterial color="#8de9ff" size={0.035} transparent opacity={0.62} sizeAttenuation />
  </points>;
}

function FloodLayer({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <group>
    {[
      [-2.5, 1.5, 0.9], [1.7, 0.9, -3.6], [4.2, 0.8, 1.9],
    ].map(([x, sx, z], i) => <mesh key={i} position={[x, 0.025, z]} rotation={[-Math.PI / 2, 0, 0]}>
      <circleGeometry args={[sx, 32]} /><meshBasicMaterial color="#40bfff" transparent opacity={0.28} depthWrite={false} />
    </mesh>)}
  </group>;
}


function TrafficSignal({ x, z }: { x: number; z: number }) {
  const lamps = useRef<Array<THREE.Mesh | null>>([]);
  useFrame(({ clock }) => {
    const phase = clock.getElapsedTime() % 8;
    const activeLamp = phase < 3 ? 0 : phase < 4 ? 1 : phase < 7 ? 2 : 1;
    lamps.current.forEach((lamp, index) => {
      if (!lamp) return;
      const material = lamp.material as THREE.MeshStandardMaterial;
      material.emissiveIntensity = index === activeLamp ? 2.1 : 0.04;
      material.color.set(index === activeLamp ? ['#ff414f', '#ffc34e', '#48ef9c'][index] : '#27332f');
    });
  });
  return <group position={[x, 0, z]}>
    <mesh position={[0, 0.72, 0]} castShadow><cylinderGeometry args={[0.035, 0.045, 1.44, 8]} /><meshStandardMaterial color="#8fa99f" metalness={0.65} roughness={0.35} /></mesh>
    <mesh position={[0, 1.47, 0.04]} castShadow><boxGeometry args={[0.25, 0.68, 0.23]} /><meshStandardMaterial color="#17211f" metalness={0.45} roughness={0.4} /></mesh>
    {[
      { y: 1.68, color: '#ff414f', glow: '#ed1d34' },
      { y: 1.47, color: '#ffc34e', glow: '#e79b21' },
      { y: 1.26, color: '#48ef9c', glow: '#19c878' },
    ].map((light, index) => <mesh key={light.y} ref={(node) => { lamps.current[index] = node; }} position={[0, light.y, 0.165]}>
      <sphereGeometry args={[0.075, 16, 16]} />
      <meshStandardMaterial color="#27332f" emissive={light.glow} emissiveIntensity={0.04} />
    </mesh>)}
  </group>;
}

function TrafficSign({ x, z, kind, text }: { x: number; z: number; kind: 'stop' | 'yield' | 'speed' | 'crossing'; text: string }) {
  const color = kind === 'stop' ? '#dc3444' : kind === 'yield' ? '#f4f2e9' : kind === 'speed' ? '#f7f8f4' : '#287de0';
  const radiusSegments = kind === 'stop' ? 8 : kind === 'yield' ? 3 : 24;
  return <group position={[x, 0, z]}>
    <mesh position={[0, 0.61, 0]} castShadow><cylinderGeometry args={[0.025, 0.035, 1.22, 8]} /><meshStandardMaterial color="#a8b8b1" metalness={0.7} /></mesh>
    <mesh position={[0, 1.28, 0.035]} rotation={[0, 0, 0]} castShadow>
      <circleGeometry args={[kind === 'yield' ? 0.27 : kind === 'speed' ? 0.25 : 0.23, radiusSegments]} />
      <meshStandardMaterial color={kind === 'yield' || kind === 'speed' ? '#d83342' : color} side={THREE.DoubleSide} metalness={0.12} roughness={0.42} />
    </mesh>
    {(kind === 'yield' || kind === 'speed') && <mesh position={[0, 1.28, 0.047]} rotation={[0, 0, 0]}>
      <circleGeometry args={[kind === 'yield' ? 0.215 : 0.198, radiusSegments]} />
      <meshStandardMaterial color="#f7f7ef" side={THREE.DoubleSide} roughness={0.5} />
    </mesh>}
    <Html position={[0, 1.28, 0.065]} center distanceFactor={10}>
      <div className={`scene-traffic-sign-face scene-traffic-sign-${kind}`}>{text}</div>
    </Html>
  </group>;
}

function PedestrianCrossing({ x, z, orientation = 'horizontal' }: { x: number; z: number; orientation?: 'horizontal' | 'vertical' }) {
  return <group position={[x, 0.005, z]} rotation={[0, orientation === 'vertical' ? Math.PI / 2 : 0, 0]}>
    {Array.from({ length: 7 }, (_, index) => <mesh key={index} position={[(index - 3) * 0.105, 0, 0]} rotation={[-Math.PI / 2, 0, 0]}>
      <planeGeometry args={[0.055, 0.27]} />
      <meshBasicMaterial color="#d8e6df" transparent opacity={0.82} />
    </mesh>)}
  </group>;
}

function TrafficInfrastructure({ visible }: { visible: boolean }) {
  if (!visible) return null;
  return <group>
    <TrafficSignal x={0.36} z={0.36} />
    <TrafficSignal x={3.34} z={-0.34} />
    <TrafficSignal x={-3.34} z={3.34} />
    <TrafficSign x={-3.52} z={0.56} kind="stop" text="STOP" />
    <TrafficSign x={3.48} z={2.95} kind="yield" text="YIELD" />
    <TrafficSign x={0.56} z={-3.45} kind="speed" text="40" />
    <TrafficSign x={-0.58} z={3.5} kind="crossing" text="✚" />
    <PedestrianCrossing x={0} z={0.0} />
    <PedestrianCrossing x={3.0} z={0.0} orientation="vertical" />
    <PedestrianCrossing x={-3.0} z={3.0} orientation="vertical" />
  </group>;
}

function Scene({ heat, shade, air, flood, trafficSigns, resetSignal, view, time }: { heat: boolean; shade: boolean; air: boolean; flood: boolean; trafficSigns: boolean; resetSignal: number; view: 'orbit' | 'top'; time: number }) {
  const heatLevel = 0.18 + 0.82 * Math.max(0, 1 - Math.abs(time - 13) / 6);
  const curve = useMemo(() => new THREE.CatmullRomCurve3([
    new THREE.Vector3(-6.5, 0.18, 4.4), new THREE.Vector3(-4.5, 0.22, 2.9), new THREE.Vector3(-2.3, 0.2, 3.5),
    new THREE.Vector3(-0.4, 0.24, 0.7), new THREE.Vector3(2.1, 0.2, 1.0), new THREE.Vector3(3.3, 0.22, -1.6), new THREE.Vector3(5.8, 0.2, -4.7),
  ]), []);
  return <>
    <PerspectiveCamera makeDefault position={view === 'top' ? ([0, 18, 0.01] as [number, number, number]) : ([11, 11, 13] as [number, number, number])} fov={42} />
    <OrbitControls key={`${view}-${resetSignal}`} makeDefault target={[0, 0.2, 0]} minDistance={7} maxDistance={22} maxPolarAngle={view === 'top' ? Math.PI / 1.95 : Math.PI / 2.05} enableDamping dampingFactor={0.08} />
    <color attach="background" args={['#061310']} />
    <fog attach="fog" args={['#061310', 15, 28]} />
    <ambientLight intensity={0.85} />
    <directionalLight position={[7, 12, 4]} intensity={2.3} castShadow shadow-mapSize-width={1024} shadow-mapSize-height={1024} />
    <pointLight position={[-6, 5, 3]} color="#39dcb2" intensity={20} distance={18} />
    <pointLight position={[5, 4, -5]} color="#ff8c4a" intensity={12} distance={15} />
    <Stars radius={45} depth={22} count={800} factor={2} saturation={0.25} fade speed={0.4} />
    <mesh rotation={[-Math.PI / 2, 0, 0]} position={[0, -0.12, 0]} receiveShadow>
      <planeGeometry args={[22, 22]} /><meshStandardMaterial color="#0a201b" roughness={0.9} />
    </mesh>
    <gridHelper args={[22, 44, '#246457', '#143c34']} position={[0, -0.1, 0]} />
    {/* road network */}
    {[-6, -3, 0, 3, 6].map((p) => <group key={`road-${p}`}>
      <mesh position={[p, -0.045, 0]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[0.23, 20]} /><meshBasicMaterial color="#28443f" /></mesh>
      <mesh position={[0, -0.044, p]} rotation={[-Math.PI / 2, 0, 0]}><planeGeometry args={[20, 0.23]} /><meshBasicMaterial color="#28443f" /></mesh>
    </group>)}
    {buildings.map((item) => <Building key={item.id} item={item} heat={heat} heatLevel={heatLevel} />)}
    {shade && Array.from({ length: 22 }, (_, i) => <Tree key={`tree-${i}`} x={-7 + (i % 11) * 1.35} z={i < 11 ? -5.7 : 5.6} scale={0.72 + (i % 3) * 0.12} />)}
    <HeatVolumes visible={heat} heatLevel={heatLevel} />
    <AirParticles visible={air} />
    <FloodLayer visible={flood} />
    <TrafficInfrastructure visible={trafficSigns} />
    <mesh position={[-6.5, 0.15, 4.4]}><sphereGeometry args={[0.19, 24, 24]} /><meshStandardMaterial color="#e7fff7" emissive="#4affc5" emissiveIntensity={2.5} /></mesh>
    <mesh position={[5.8, 0.15, -4.7]}><sphereGeometry args={[0.19, 24, 24]} /><meshStandardMaterial color="#fff1d9" emissive="#ff9a4a" emissiveIntensity={2.4} /></mesh>
    <Line points={curve.getPoints(90)} color="#62ffbf" lineWidth={5} transparent opacity={0.2} />
    <Line points={curve.getPoints(90)} color="#8affcf" lineWidth={2} />
    <RoutePulse curve={curve} />
    <Html position={[-6.5, 0.8, 4.4]} center distanceFactor={10}>
      <div className="scene-marker scene-marker-start"><span>START</span><strong>A</strong></div>
    </Html>
    <Html position={[5.8, 0.8, -4.7]} center distanceFactor={10}>
      <div className="scene-marker scene-marker-end"><span>DESTINATION</span><strong>B</strong></div>
    </Html>
  </>;
}

export default function CityDigitalTwin({ time }: { time: number }) {
  const [heat, setHeat] = useState(true);
  const [shade, setShade] = useState(true);
  const [air, setAir] = useState(false);
  const [flood, setFlood] = useState(false);
  const [trafficSigns, setTrafficSigns] = useState(true);
  const [resetSignal, setResetSignal] = useState(0);
  const [view, setView] = useState<'orbit' | 'top'>('orbit');
  return <div className="digital-twin">
    <Canvas shadows="percentage" dpr={[1, 1.6]} gl={{ antialias: true, alpha: false }}>
      <Scene heat={heat} shade={shade} air={air} flood={flood} trafficSigns={trafficSigns} resetSignal={resetSignal} view={view} time={time} />
    </Canvas>
    <div className="scene-hud scene-hud-top">
      <div className="scene-chip"><span className="pulse-dot" /> 3D DIGITAL TWIN <small>DEMO MODE</small></div>
      <div className="scene-toolset">
        <button onClick={() => { setView('orbit'); setResetSignal((v) => v + 1); }} title="Reset camera">⟳</button>
        <button onClick={() => setView((v) => v === 'orbit' ? 'top' : 'orbit')} title="Switch view">{view === 'orbit' ? '▦' : '◈'}</button>
      </div>
    </div>
    <div className="scene-layers">
      <span className="layers-label">VISUAL LAYERS</span>
      <button className={heat ? 'layer-active layer-heat' : ''} onClick={() => setHeat((v) => !v)}><i /> Heat</button>
      <button className={shade ? 'layer-active layer-shade' : ''} onClick={() => setShade((v) => !v)}><i /> Green cover</button>
      <button className={air ? 'layer-active layer-air' : ''} onClick={() => setAir((v) => !v)}><i /> Air particles</button>
      <button className={flood ? 'layer-active layer-flood' : ''} onClick={() => setFlood((v) => !v)}><i /> Flood zones</button>
      <button className={trafficSigns ? 'layer-active layer-signs' : ''} onClick={() => setTrafficSigns((v) => !v)}><i /> Traffic signs</button>
    </div>
    <div className="scene-caption"><span>DRAG TO ORBIT</span><b>•</b><span>SCROLL TO ZOOM</span><b>•</b><span>CLICK LAYERS TO EXPLORE</span></div>
    <div className="scene-scale"><span className="scale-line" /> 1 KM GRID <span className="scale-divider" /> BENGALURU · CONCEPT VIEW <span className="scale-divider" /> {String(time).padStart(2, '0')}:00</div>
  </div>;
}

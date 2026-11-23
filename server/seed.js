// Deterministic demo data, generated relative to "now" so the app always looks
// live. Includes deliberate conflict scenarios for demonstrating the resolver.
import { DEMO_PASSWORD } from './constants.js';
import { addDays, dayOfWeek, hourLabel } from './lib/time.js';
import { hashPasswordSync } from './lib/security.js';
import { audit, notify } from './services/activity.js';
import { bookingsFor, findConflicts, hoursOf, isOpenDay, isPastSlot, weekHours } from './services/scheduling.js';

function mulberry32(seed) {
  let a = seed;
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const CUSTODIANS = { ECE: 'u-rao', CSE: 'u-kavya', ME: 'u-menon', CHE: 'u-das', BT: 'u-bose', PHY: 'u-pillai' };

// [id, name, category, dept, location, icon, description, specs, tags, options]
const EQUIPMENT = [
  ['eq-dso', 'Mixed-Signal Oscilloscope 200 MHz', 'Test & Measurement', 'ECE', 'Block A · Lab 204', 'oscilloscope', 'Four analog and sixteen digital channels with deep memory and built-in protocol decoding. The workhorse for debugging embedded and analog designs.', ['4 analog + 16 digital channels', '200 MHz bandwidth, 1 GSa/s', 'I²C, SPI, UART and CAN decode'], ['oscilloscope', 'signal', 'waveform', 'debugging', 'embedded', 'measurement', 'analog', 'digital'], { pop: 0.9 }],
  ['eq-la', '16-Channel Logic Analyzer', 'Test & Measurement', 'ECE', 'Block A · Lab 204', 'wave', 'USB logic analyzer for capturing and decoding digital buses on microcontroller and FPGA boards.', ['16 channels, 500 MS/s', 'Protocol analyzers: I²C, SPI, CAN, 1-Wire'], ['logic analyzer', 'digital', 'protocol', 'debug', 'i2c', 'spi', 'fpga'], { pop: 0.4 }],
  ['eq-awg', 'Arbitrary Waveform Generator 80 MHz', 'Test & Measurement', 'ECE', 'Block A · Lab 204', 'wave', 'Dual-channel function and arbitrary waveform generator for stimulus and sensor characterisation.', ['2 channels, 80 MHz', '14-bit, 300 MSa/s', 'Modulation: AM, FM, PWM'], ['signal generator', 'waveform', 'function generator', 'test', 'analog'], { pop: 0.3 }],
  ['eq-sa', 'RF Spectrum Analyzer 3.2 GHz', 'Test & Measurement', 'ECE', 'Block A · RF Lab 110', 'radio', 'Spectrum analysis for RF front-ends, antennas and EMI pre-compliance. Access is project-based and needs faculty approval.', ['9 kHz – 3.2 GHz', '-135 dBm DANL', 'Tracking generator'], ['rf', 'spectrum', 'wireless', 'antenna', '5g', 'emi', 'radio'], { approval: true, max: 3, auto: 2, pop: 0.85 }],
  ['eq-vna', 'Vector Network Analyzer 6 GHz', 'Test & Measurement', 'ECE', 'Block A · RF Lab 110', 'radio', 'Two-port VNA for S-parameter, impedance and antenna matching measurements.', ['2 ports, 6 GHz', 'Full 2-port calibration kit', 'Smith chart and time-domain mode'], ['rf', 'antenna', 's-parameters', 'impedance', 'microwave', 'wireless'], { approval: true, max: 3, auto: 2, pop: 0.45 }],
  ['eq-psu', 'Programmable DC Power Supply Bench', 'Test & Measurement', 'ECE', 'Block A · Lab 201', 'wave', 'Four-channel programmable bench supply with logging for powering and characterising prototypes.', ['4 channels, up to 60 V / 10 A', 'Over-current protection', 'USB/LAN control'], ['power supply', 'voltage', 'current', 'bench', 'measurement'], { pop: 0.35 }],
  ['eq-solder', 'Rework & Soldering Station', 'Fabrication', 'ECE', 'Block A · Lab 201', 'wrench', 'Temperature-controlled iron plus hot-air rework station for through-hole and SMD assembly.', ['Hot air + iron', 'Fume extraction', 'Stereo microscope'], ['soldering', 'pcb', 'rework', 'smd', 'assembly'], { pop: 0.55 }],
  ['eq-pcbmill', 'PCB Prototyping Mill', 'Fabrication', 'ECE', 'Block A · Fab Room', 'wrench', 'In-house milling of single and double-sided PCBs in under an hour. Needs approval and a safety briefing.', ['0.1 mm trace/space', 'Automatic tool change', 'Vacuum table'], ['pcb', 'milling', 'prototyping', 'circuit board', 'etching'], { approval: true, max: 4, auto: 2, pop: 0.5 }],
  ['eq-stm32', 'STM32 Nucleo-H7 Dev Kit Bundle', 'Development Kits', 'ECE', 'Block A · Kit Counter', 'chip', 'Ten STM32 Nucleo-H7 boards with ST-LINK debuggers, shields and cables for embedded firmware projects.', ['Arm Cortex-M7 @ 480 MHz', 'Ethernet + USB', 'Arduino/ST Morpho headers'], ['microcontroller', 'stm32', 'arm', 'cortex', 'embedded', 'firmware', 'mcu'], { pop: 0.5 }],
  ['eq-esp32', 'ESP32 IoT Starter Bundle', 'Development Kits', 'ECE', 'Block A · Kit Counter', 'chip', 'Ten ESP32 boards with Wi-Fi/Bluetooth, soil, temperature and air-quality sensors for IoT prototypes.', ['Wi-Fi + BLE 5', 'Soil moisture, DHT22, BME680, OLED', 'LoRa add-on modules'], ['iot', 'wifi', 'bluetooth', 'esp32', 'sensors', 'microcontroller', 'wireless'], { pop: 0.75 }],
  ['eq-rpi', 'Raspberry Pi 5 + Sense HAT Kit', 'Development Kits', 'ECE', 'Block A · Kit Counter', 'chip', 'Single-board Linux computers with camera, Sense HAT and displays for edge and automation projects.', ['Quad-core Arm Cortex-A76', '8 GB RAM, camera module 3', 'Sense HAT with IMU'], ['raspberry pi', 'linux', 'sbc', 'sensors', 'iot', 'edge'], { pop: 0.4 }],
  ['eq-fpga', 'FPGA Development Board (Artix-7)', 'Development Kits', 'ECE', 'Block B · Digital Lab', 'chip', 'Xilinx Artix-7 board with HDMI, Ethernet and Pmod ports for digital design and acceleration.', ['35k logic cells', 'DDR3 256 MB', 'Vivado licence seat'], ['fpga', 'verilog', 'vhdl', 'hardware', 'logic', 'digital design', 'xilinx'], { pop: 0.35 }],
  ['eq-jetson', 'Edge-AI Developer Kit (Jetson Orin Nano)', 'Development Kits', 'CSE', 'Block C · AI Lab', 'chip', 'GPU-accelerated edge AI kit for computer vision, inference and robotics. In very high demand near project deadlines.', ['40 TOPS AI performance', '8 GB LPDDR5', 'CSI camera, CUDA/TensorRT'], ['ai', 'edge', 'gpu', 'jetson', 'computer vision', 'deep learning', 'inference', 'cuda'], { max: 4, auto: 4, pop: 0.95 }],
  ['eq-sdr', 'Software-Defined Radio (USRP B210)', 'Development Kits', 'ECE', 'Block A · RF Lab 110', 'radio', 'Full-duplex SDR covering 70 MHz – 6 GHz for wireless, 5G and signal-processing experiments with GNU Radio.', ['70 MHz – 6 GHz', '56 MHz bandwidth', '2x2 MIMO'], ['sdr', 'radio', 'wireless', '5g', 'rf', 'gnu radio'], { approval: true, max: 4, auto: 3, pop: 0.45 }],
  ['eq-arduino', 'Arduino Mega Sensor Kit', 'Development Kits', 'ECE', 'Block A · Kit Counter', 'chip', 'Beginner-friendly Arduino Mega kits with 37 sensors and actuators for rapid prototyping.', ['ATmega2560', '37 sensor modules', 'Breadboards and jumpers'], ['arduino', 'sensors', 'beginner', 'microcontroller', 'prototyping'], { pop: 0.3 }],
  ['eq-gpu', 'GPU Compute Workstation (2× RTX 4090)', 'Computing', 'CSE', 'Block C · Server Room', 'server', 'Dual-GPU workstation for deep-learning training and large simulations. Project access is approved by faculty.', ['2× 24 GB VRAM', '128 GB RAM, 64-core CPU', 'CUDA, PyTorch, TensorFlow'], ['gpu', 'deep learning', 'training', 'cuda', 'machine learning', 'ai', 'neural network'], { approval: true, max: 6, auto: 3, open: 8, close: 20, days: [0, 1, 2, 3, 4, 5, 6], pop: 0.9 }],
  ['eq-hpc', 'HPC Simulation Node (64-core)', 'Computing', 'CSE', 'Block C · Server Room', 'server', 'High-memory node for CFD, FEA and parallel simulation workloads.', ['64 cores, 256 GB RAM', 'ANSYS, MATLAB, OpenFOAM', 'SLURM scheduling'], ['simulation', 'hpc', 'cfd', 'parallel', 'compute', 'matlab', 'ansys'], { approval: true, max: 6, auto: 3, open: 8, close: 20, days: [0, 1, 2, 3, 4, 5, 6], pop: 0.4 }],
  ['eq-vr', 'AR/VR Developer Headset Kit', 'Computing', 'CSE', 'Block C · XR Studio', 'vr', 'Standalone headsets with controllers and a Unity-ready workstation for immersive prototypes.', ['2× standalone headsets', 'Hand tracking', 'Unity + OpenXR workstation'], ['vr', 'ar', 'xr', 'unity', 'immersive', 'headset', '3d'], { pop: 0.3 }],
  ['eq-cad', 'Engineering Design Workstation', 'Computing', 'ME', 'Block D · Design Studio', 'server', 'Licensed CAD/EDA seat (SolidWorks, Altium, Fusion) on a high-end workstation.', ['SolidWorks, Altium, Fusion 360', '32 GB RAM, pro GPU', '4K dual monitors'], ['cad', 'eda', 'solidworks', 'altium', 'design', 'simulation'], { max: 6, auto: 4, open: 8, close: 20, pop: 0.5 }],
  ['eq-fdm', 'Large-Format FDM 3D Printer', 'Fabrication', 'ME', 'Block D · Makerspace', 'printer', 'Enclosed 3D printer for PLA, PETG, ABS and nylon parts up to 300 mm cubed.', ['300 × 300 × 300 mm', '0.05 mm layer height', 'Enclosure + HEPA filter'], ['3d printing', 'prototype', 'pla', 'abs', 'additive', 'enclosure'], { max: 6, auto: 3, pop: 0.85 }],
  ['eq-sla', 'High-Resolution Resin 3D Printer', 'Fabrication', 'ME', 'Block D · Makerspace', 'printer', 'SLA printer for fine-detail parts, moulds and miniatures.', ['25 µm XY resolution', '145 × 145 × 175 mm', 'Wash & cure station'], ['3d printing', 'resin', 'high resolution', 'mold', 'miniature'], { status: 'maintenance', pop: 0.4 }],
  ['eq-laser', 'CO₂ Laser Cutter 60 W', 'Fabrication', 'ME', 'Block D · Makerspace', 'laser', 'Cut and engrave acrylic, wood and card. Requires safety induction and faculty approval.', ['600 × 400 mm bed', '60 W CO₂ tube', 'Air assist + extraction'], ['laser', 'cutting', 'engraving', 'acrylic', 'wood', 'fabrication'], { approval: true, max: 3, auto: 2, pop: 0.6 }],
  ['eq-cnc', 'Desktop CNC Milling Machine', 'Fabrication', 'ME', 'Block D · Workshop', 'wrench', 'Three-axis desktop mill for aluminium, plastics and wax. Needs approval and a trained supervisor.', ['3-axis, 300 × 180 mm', 'Spindle 24,000 rpm', 'Fusion 360 CAM'], ['cnc', 'milling', 'machining', 'aluminium', 'prototype'], { approval: true, max: 4, auto: 2, pop: 0.5 }],
  ['eq-utm', 'Universal Testing Machine 50 kN', 'Test & Measurement', 'ME', 'Block D · Materials Lab', 'scale', 'Tensile, compression and flexural testing for materials and 3D-printed parts.', ['50 kN load cell', 'Extensometer', 'Digital image correlation'], ['tensile', 'strength', 'materials', 'testing', 'compression', 'stress'], { approval: true, max: 3, auto: 2, pop: 0.35 }],
  ['eq-ur3', 'Collaborative Robot Arm (6-DOF)', 'Robotics', 'ME', 'Block D · Robotics Cell', 'robot', 'Six-axis cobot with gripper and vision kit for pick-and-place, assembly and ROS research.', ['3 kg payload, 500 mm reach', 'ROS 2 driver', 'Two-finger gripper + camera'], ['robot', 'robotic arm', 'automation', 'manipulator', 'pick and place', 'cobot', 'ros'], { approval: true, max: 4, auto: 3, pop: 0.7 }],
  ['eq-rover', 'Mobile Robot Platform (ROS 2)', 'Robotics', 'ECE', 'Block B · Robotics Arena', 'robot', 'Differential-drive robot with LiDAR and depth camera for navigation and SLAM projects.', ['2D LiDAR + depth camera', 'ROS 2 Humble', '4 h battery'], ['robot', 'ros', 'navigation', 'lidar', 'slam', 'autonomous', 'mobile'], { pop: 0.45 }],
  ['eq-drone', 'Quadcopter Test Rig & Flight Kit', 'Robotics', 'ME', 'Block D · Flight Cage', 'drone', 'Safe tethered test rig and flight kit with PX4 flight controllers for UAV research.', ['Tethered thrust rig', 'PX4 flight controller', 'Netted flight cage'], ['drone', 'uav', 'flight controller', 'aerial', 'px4'], { pop: 0.35 }],
  ['eq-uvvis', 'UV-Vis Spectrophotometer', 'Chemistry', 'CHE', 'Block E · Instrument Lab 3', 'flask', 'Double-beam UV-Vis for absorbance and concentration analysis of solutions and nanoparticle samples.', ['190 – 1100 nm', 'Double beam', 'Peltier cuvette holder'], ['spectroscopy', 'absorbance', 'uv', 'concentration', 'analysis', 'nanoparticle'], { max: 3, auto: 3, pop: 0.6 }],
  ['eq-hplc', 'HPLC System', 'Chemistry', 'CHE', 'Block E · Instrument Lab 1', 'flask', 'High-performance liquid chromatography for purity and separation analysis. Currently under calibration.', ['Quaternary pump', 'Diode array detector', 'Autosampler 100 vials'], ['chromatography', 'hplc', 'separation', 'purity', 'analysis'], { approval: true, status: 'maintenance', max: 4, auto: 2, pop: 0.5 }],
  ['eq-rotavap', 'Rotary Evaporator', 'Chemistry', 'CHE', 'Block E · Synthesis Lab', 'flask', 'Gentle solvent removal and concentration under vacuum.', ['5 L flask', 'Chiller + vacuum pump', 'Digital bath control'], ['distillation', 'solvent', 'evaporation', 'synthesis', 'extraction'], { pop: 0.25 }],
  ['eq-micro', 'Trinocular Fluorescence Microscope', 'Microscopy & Imaging', 'BT', 'Block F · Cell Lab', 'microscope', 'Research microscope with fluorescence filters and a 12 MP camera for cell and tissue imaging.', ['4×–100× objectives', 'DAPI/FITC/TRITC filters', '12 MP camera'], ['microscope', 'cells', 'fluorescence', 'imaging', 'biology', 'histology'], { pop: 0.65 }],
  ['eq-pcr', 'qPCR Thermal Cycler', 'Life Sciences', 'BT', 'Block F · Molecular Lab', 'dna', 'Real-time PCR with 96-well block for gene expression and CRISPR assay readouts.', ['96-well, 5 channels', 'Gradient block', 'Melt-curve analysis'], ['pcr', 'dna', 'gene expression', 'amplification', 'crispr', 'molecular biology'], { approval: true, max: 4, auto: 3, pop: 0.6 }],
  ['eq-gel', 'Gel Electrophoresis & Imager', 'Life Sciences', 'BT', 'Block F · Molecular Lab', 'dna', 'Horizontal gel electrophoresis with a blue-light gel documentation system.', ['Up to 4 gels', 'Blue-light transilluminator', 'Image capture software'], ['dna', 'protein', 'gel', 'electrophoresis', 'western blot'], { pop: 0.35 }],
  ['eq-bsc', 'Class II Biosafety Cabinet', 'Life Sciences', 'BT', 'Block F · Cell Culture Suite', 'dna', 'Sterile workspace for cell culture. Access is restricted to trained, approved project members.', ['Class II A2', 'HEPA filtered', 'UV decontamination'], ['sterile', 'cell culture', 'biosafety', 'bacteria'], { approval: true, max: 4, auto: 3, pop: 0.45 }],
  ['eq-sem', 'Benchtop Scanning Electron Microscope', 'Microscopy & Imaging', 'PHY', 'Block G · Nano Lab', 'microscope', 'Benchtop SEM with EDS for surface morphology and elemental analysis of materials and nanostructures.', ['Magnification up to 100,000×', 'Backscatter + EDS detectors', 'Sample loading in < 3 min'], ['sem', 'microscope', 'nanostructure', 'imaging', 'materials', 'surface'], { approval: true, max: 3, auto: 2, pop: 0.9 }],
  ['eq-afm', 'Atomic Force Microscope', 'Microscopy & Imaging', 'PHY', 'Block G · Nano Lab', 'microscope', 'Nanoscale surface topography and force spectroscopy.', ['Sub-nm vertical resolution', 'Contact + tapping modes', '90 µm scan range'], ['afm', 'nanoscale', 'surface', 'topography', 'microscope'], { approval: true, max: 3, auto: 2, pop: 0.35 }],
  ['eq-optics', 'Optical Table with Diode Laser Kit', 'Optics & Photonics', 'PHY', 'Block G · Optics Lab', 'laser', 'Vibration-isolated table with lasers, mounts and detectors for interferometry and photonics experiments.', ['1.2 × 1.8 m isolated table', '635 / 532 nm lasers', 'Interferometer optics set'], ['laser', 'optics', 'interferometer', 'photonics', 'alignment', 'lens'], { pop: 0.4 }],
];

const USERS = [
  ['u-admin', 'Dr. Meera Iyer', 'admin@lablink.edu', 'admin', 'ECE', 'Central Lab Coordinator'],
  ['u-rao', 'Prof. Arvind Rao', 'rao@lablink.edu', 'faculty', 'ECE', 'Professor, ECE'],
  ['u-kavya', 'Dr. Kavya Nair', 'kavya@lablink.edu', 'faculty', 'CSE', 'Associate Professor, CSE'],
  ['u-menon', 'Prof. Suresh Menon', 'menon@lablink.edu', 'faculty', 'ME', 'Professor, Mechanical'],
  ['u-das', 'Dr. Anita Das', 'das@lablink.edu', 'faculty', 'CHE', 'Associate Professor, Chemical'],
  ['u-bose', 'Dr. Sourav Bose', 'bose@lablink.edu', 'faculty', 'BT', 'Assistant Professor, Biotech'],
  ['u-pillai', 'Dr. Rajesh Pillai', 'pillai@lablink.edu', 'faculty', 'PHY', 'Professor, Physics'],
  ['u-aarav', 'Aarav Sharma', 'aarav@lablink.edu', 'student', 'ECE', 'B.Tech, 4th year'],
  ['u-vikram', 'Vikram Singh', 'vikram@lablink.edu', 'student', 'ECE', 'B.Tech, 3rd year'],
  ['u-arjun', 'Arjun Kapoor', 'arjun@lablink.edu', 'student', 'ECE', 'B.Tech, 4th year'],
  ['u-isha', 'Isha Patel', 'isha@lablink.edu', 'student', 'CSE', 'B.Tech, 4th year'],
  ['u-priya', 'Priya Nair', 'priya@lablink.edu', 'student', 'CSE', 'B.Tech, 4th year'],
  ['u-rohan', 'Rohan Gupta', 'rohan@lablink.edu', 'student', 'ME', 'B.Tech, 4th year'],
  ['u-sneha', 'Sneha Reddy', 'sneha@lablink.edu', 'student', 'BT', 'M.Tech, 1st year'],
  ['u-zoya', 'Zoya Khan', 'zoya@lablink.edu', 'student', 'BT', 'M.Tech, 1st year'],
  ['u-karthik', 'Karthik Iyer', 'karthik@lablink.edu', 'student', 'CHE', 'B.Tech, 3rd year'],
  ['u-diya', 'Diya Menon', 'diya@lablink.edu', 'student', 'PHY', 'M.Sc, 2nd year'],
];

// Background research scholars: they generate realistic load on restricted equipment.
const SCHOLARS = [
  ['ananya', 'Ananya Krishnan', 'ECE'], ['dev', 'Dev Malhotra', 'ECE'], ['fatima', 'Fatima Sheikh', 'CSE'],
  ['gautam', 'Gautam Rao', 'CSE'], ['harini', 'Harini Subramanian', 'ME'], ['imran', 'Imran Qureshi', 'ME'],
  ['jaya', 'Jaya Lakshmi', 'BT'], ['kabir', 'Kabir Verma', 'CHE'], ['leela', 'Leela Thomas', 'PHY'], ['manav', 'Manav Joshi', 'PHY'],
];

// Students whose conversation-ready headroom must survive the random history.
const DEMO_USERS = new Set(['u-aarav', 'u-vikram', 'u-arjun', 'u-isha', 'u-priya']);
const DEMO_USER_WEEKLY_CAP = 5;

// [id, title, description, owner, members, guide, dept, deadline(+days), kind, plannedHours]
const PROJECTS = [
  ['p-irrigation', 'Smart Irrigation IoT Node', 'Soil-moisture sensing node using ESP32 and LoRa uplink with a solar power budget. Needs sensor kits, an oscilloscope for power profiling and a PCB prototype.', 'u-aarav', ['u-vikram'], 'u-rao', 'ECE', 9, 'capstone', 14],
  ['p-sorter', 'Edge-AI Waste Sorter', 'Real-time waste classification on a Jetson edge device driving a pick-and-place robot arm. Requires GPU training time and robot cell access.', 'u-isha', ['u-priya'], 'u-kavya', 'CSE', 6, 'capstone', 16],
  ['p-prosthetic', 'Low-Cost Prosthetic Hand', 'Tendon-driven 3D-printed hand with force feedback, machined aluminium parts and tensile testing of printed joints.', 'u-rohan', [], 'u-menon', 'ME', 20, 'capstone', 18],
  ['p-crispr', 'CRISPR Assay Optimisation', 'Optimising guide-RNA cutting efficiency using qPCR readouts and sterile cell culture work.', 'u-sneha', ['u-zoya'], 'u-bose', 'BT', 30, 'research', 20],
  ['p-nano', 'Nanoparticle Absorbance Study', 'UV-Vis characterisation of gold nanoparticle batches with chromatographic purity checks.', 'u-karthik', [], 'u-das', 'CHE', 14, 'course', 8],
  ['p-interf', 'Michelson Interferometer Alignment', 'Automated fringe counting for surface-roughness measurement, with SEM and AFM verification.', 'u-diya', [], 'u-pillai', 'PHY', 25, 'research', 12],
  ['p-5g', '5G Front-End Characterisation', 'Measuring gain, linearity and spectrum emissions of a sub-6 GHz 5G front-end module using RF instruments and an SDR.', 'u-arjun', [], 'u-rao', 'ECE', 4, 'capstone', 10],
  ['p-drone', 'Weekend Drone Controller', 'Hobby flight controller for a racing quadcopter, with an occasional RF spectrum check.', 'u-vikram', [], 'u-rao', 'ECE', 40, 'personal', 10],
];

// [id, project, equipment, status, hours, note]
const ACCESS = [
  ['ar-1', 'p-sorter', 'eq-gpu', 'approved', 12, 'Training the waste-classification model.'],
  ['ar-2', 'p-sorter', 'eq-ur3', 'approved', 8, 'Pick-and-place integration with the Jetson.'],
  ['ar-3', 'p-5g', 'eq-sa', 'approved', 8, 'Emission mask measurements.'],
  ['ar-4', 'p-5g', 'eq-sdr', 'approved', 6, 'Transmit-chain test signals.'],
  ['ar-5', 'p-drone', 'eq-sa', 'approved', 3, 'Check the 2.4 GHz video transmitter spectrum.'],
  ['ar-6', 'p-prosthetic', 'eq-cnc', 'approved', 10, 'Machining aluminium finger links.'],
  ['ar-7', 'p-crispr', 'eq-pcr', 'approved', 14, 'Daily qPCR runs.'],
  ['ar-8', 'p-crispr', 'eq-bsc', 'approved', 12, 'Sterile cell culture.'],
  ['ar-9', 'p-5g', 'eq-vna', 'pending', 4, 'Antenna S11 and matching network tuning.'],
  ['ar-10', 'p-irrigation', 'eq-pcbmill', 'pending', 3, 'Mill the sensor-node PCB revision B.'],
  ['ar-11', 'p-prosthetic', 'eq-laser', 'pending', 2, 'Cut acrylic palm templates.'],
  ['ar-12', 'p-interf', 'eq-sem', 'pending', 4, 'Verify surface roughness against fringe counts.'],
  ['ar-13', 'p-interf', 'eq-afm', 'pending', 3, 'Nanoscale topography cross-check.'],
  ['ar-14', 'p-prosthetic', 'eq-utm', 'pending', 4, 'Tensile testing of printed joint specimens.'],
];

function nextOpenDate(date) {
  let d = addDays(date, 1);
  while (dayOfWeek(d) === 0) d = addDays(d, 1);
  return d;
}

export function seedStore(store, now) {
  const rand = mulberry32(2026);
  const passwordHash = hashPasswordSync(DEMO_PASSWORD);
  const createdAt = Date.now();

  for (const [id, name, email, role, department, title] of USERS) {
    store.data.users.push({ id, name, email, role, department, title, passwordHash, weeklyQuota: role === 'student' ? 12 : null, karma: 0, active: true, createdAt });
  }

  for (const [id, name, category, department, location, icon, description, specs, tags, o] of EQUIPMENT) {
    store.data.equipment.push({
      id, name, category, department, location, icon, description, specs, tags,
      status: o.status ?? 'available', requiresApproval: Boolean(o.approval),
      maxHoursPerBooking: o.max ?? 4, autoApproveHours: o.auto ?? 3,
      openHour: o.open ?? 9, closeHour: o.close ?? 18, openDays: o.days ?? [1, 2, 3, 4, 5, 6],
      custodianId: CUSTODIANS[department], popularity: o.pop ?? 0.35,
    });
  }

  for (const [id, title, description, ownerId, memberIds, guideId, department, offset, kind, plannedHours] of PROJECTS) {
    store.data.projects.push({ id, title, description, ownerId, memberIds, guideId, department, deadline: addDays(now.date, offset), kind, status: 'active', plannedHours, createdAt });
  }

  for (const [id, projectId, equipmentId, status, hoursNeeded, justification] of ACCESS) {
    const project = store.get('projects', projectId);
    const eq = store.get('equipment', equipmentId);
    store.data.accessRequests.push({
      id, projectId, equipmentId, requesterId: project.ownerId, justification, hoursNeeded, status,
      validUntil: addDays(project.deadline, 7), createdAt: createdAt - 86_400_000,
      ...(status === 'approved' && { decidedBy: eq.custodianId, comment: 'Approved. Please follow the lab safety rules.', decidedAt: createdAt - 43_200_000 }),
    });
  }

  for (const [key, name, department] of SCHOLARS) {
    const id = `u-s-${key}`;
    store.data.users.push({ id, name, email: `${key}@lablink.edu`, role: 'student', department, title: 'PhD Scholar', passwordHash, weeklyQuota: 30, karma: 0, active: true, createdAt });
    const guideId = CUSTODIANS[department];
    store.data.projects.push({ id: `p-r-${key}`, title: `${department} Research Programme`, description: `Long-running doctoral research in ${department}.`, ownerId: id, memberIds: [], guideId, department, deadline: addDays(now.date, 90), kind: 'research', status: 'active', plannedHours: 200, createdAt });
    for (const eq of store.data.equipment.filter((e) => e.requiresApproval && (e.department === department || e.category === 'Computing'))) {
      store.data.accessRequests.push({ id: store.nextId('ar'), projectId: `p-r-${key}`, equipmentId: eq.id, requesterId: id, justification: 'Doctoral research experiments.', hoursNeeded: 60, status: 'approved', validUntil: addDays(now.date, 97), createdAt: createdAt - 5 * 86_400_000, decidedBy: guideId, comment: 'Approved for the research programme.', decidedAt: createdAt - 4 * 86_400_000 });
    }
  }

  const users = store.data.users;
  const hasGrant = (userId, equipmentId) =>
    store.data.accessRequests.some((r) => r.status === 'approved' && r.equipmentId === equipmentId && isMemberOf(userId, store.get('projects', r.projectId)));
  const isMemberOf = (userId, project) => project.ownerId === userId || project.memberIds.includes(userId);
  const projectsOf = (userId) => store.data.projects.filter((p) => isMemberOf(userId, p));

  const place = (userId, equipmentId, date, startHour, endHour, overrides = {}) => {
    const eq = store.get('equipment', equipmentId);
    const user = store.get('users', userId);
    if (findConflicts(store, equipmentId, date, startHour, endHour).length) return null;
    if (store.data.bookings.some((b) => b.userId === userId && b.date === date && b.status !== 'cancelled' && startHour < b.endHour && b.startHour < endHour)) return null;
    const cap = DEMO_USERS.has(userId) ? DEMO_USER_WEEKLY_CAP : user.weeklyQuota;
    if (user.role === 'student' && weekHours(store, userId, date) + (endHour - startHour) > cap) return null;
    const projects = projectsOf(userId).filter((p) => !eq.requiresApproval || store.data.accessRequests.some((r) => r.status === 'approved' && r.equipmentId === equipmentId && r.projectId === p.id));
    const project = overrides.projectId ? store.get('projects', overrides.projectId) : projects[Math.floor(rand() * projects.length)];
    const ended = date < now.date || (date === now.date && endHour <= now.hour);
    const started = isPastSlot(now, date, startHour);
    const status = overrides.status ?? (ended ? (rand() < 0.08 ? 'no_show' : 'completed') : started ? 'checked_in' : 'confirmed');
    const booking = {
      id: store.nextId('b'), equipmentId, userId, projectId: project?.id ?? null, date, startHour, endHour,
      purpose: overrides.purpose ?? (project ? `Work on “${project.title}”` : 'Lab work'),
      status, flexible: overrides.flexible ?? (!ended && rand() < 0.35), bumpCount: 0, priority: 0,
      createdAt: createdAt - Math.floor(rand() * 5 * 86_400_000),
    };
    store.data.bookings.push(booking);
    return booking;
  };

  // Crafted scenarios used in the demo walkthrough (all relative to today).
  const d1 = nextOpenDate(now.date);
  const d2 = nextOpenDate(d1);
  place('u-vikram', 'eq-sa', d1, 10, 13, { projectId: 'p-drone', flexible: true, purpose: 'Spectrum check for drone video transmitter' });
  place('u-priya', 'eq-jetson', d1, 9, 12, { projectId: 'p-sorter', flexible: false });
  place('u-aarav', 'eq-jetson', d1, 13, 17, { projectId: 'p-irrigation', flexible: true, purpose: 'Compare edge inference for soil images' });
  place('u-rohan', 'eq-cnc', d2, 10, 14, { projectId: 'p-prosthetic', status: 'pending', flexible: false, purpose: 'Machine aluminium finger links' });
  place('u-isha', 'eq-gpu', d2, 9, 13, { projectId: 'p-sorter', status: 'pending', flexible: false, purpose: 'Train classifier v3' });

  // Pseudo-random history and near-future load: each equipment-day is filled toward
  // a target proportional to the equipment's popularity (lighter on the demo days).
  for (let offset = -14; offset <= 10; offset++) {
    const date = addDays(now.date, offset);
    for (const eq of store.data.equipment) {
      if (eq.status !== 'available' || !isOpenDay(eq, date)) continue;
      const capacity = eq.closeHour - eq.openHour;
      const scale = date === d1 || date === d2 ? 0.45 : offset >= 0 ? 0.75 : 1;
      const target = capacity * eq.popularity * (0.7 + rand() * 0.6) * scale;
      const pool = eq.requiresApproval
        ? users.filter((u) => u.role === 'student' && hasGrant(u.id, eq.id))
        : users.filter((u) => u.role === 'student' && (u.department === eq.department || rand() < 0.3));
      let booked = bookingsFor(store, eq.id, date).reduce((sum, b) => sum + hoursOf(b), 0);
      for (let tries = 0; tries < 40 && booked < target && pool.length; tries++) {
        const user = pool[Math.floor(rand() * pool.length)];
        if (DEMO_USERS.has(user.id) && (date === d1 || date === d2)) continue;
        const length = Math.min(eq.maxHoursPerBooking, 1 + Math.floor(rand() * 3));
        const start = eq.openHour + Math.floor(rand() * (eq.closeHour - eq.openHour - length + 1));
        if (place(user.id, eq.id, date, start, start + length)) booked += length;
      }
    }
  }

  store.data.waitlist.push({
    id: store.nextId('w'), equipmentId: 'eq-jetson', userId: 'u-aarav', projectId: 'p-irrigation', date: d1, startHour: 10, endHour: 12,
    purpose: 'Inference benchmark', status: 'waiting', createdAt,
  });

  for (const r of store.data.accessRequests) {
    const eq = store.get('equipment', r.equipmentId);
    const project = store.get('projects', r.projectId);
    if (r.status === 'pending') {
      notify(store, eq.custodianId, { type: 'approval', title: 'Access request awaiting you', body: `${store.get('users', r.requesterId).name} requested ${eq.name} for “${project.title}”.`, link: '#/approvals' });
    } else {
      notify(store, r.requesterId, { type: 'access', title: 'Access approved', body: `You can now book ${eq.name} for “${project.title}”.`, link: `#/equipment/${eq.id}` });
    }
  }
  for (const b of store.data.bookings.filter((x) => x.status === 'pending')) {
    notify(store, store.get('equipment', b.equipmentId).custodianId, { type: 'approval', title: 'Booking needs approval', body: `${store.get('users', b.userId).name} requested ${hourLabel(b.startHour)}–${hourLabel(b.endHour)} on ${b.date}.`, link: '#/approvals' });
  }
  notify(store, 'u-aarav', { type: 'system', title: 'Welcome to LabLink', body: 'Ask the Copilot to find equipment, or open Planner to schedule your project hours.', link: '#/copilot' });

  // Demo history for the resolver KPI (clearly marked as seeded).
  for (let i = 0; i < 9; i++) {
    audit(store, null, 'conflict.resolved', `seed-${i}`, { demo: true });
    store.data.audit.at(-1).at = Date.now() - (i + 1) * 86_400_000;
  }
}

use extism_pdk::*;
use serde_json::Value;

// 材料科学专业英文术语表（英 -> 中）。按主题分组，便于维护与扩充。
const GLOSSARY: &[(&str, &str)] = &[
    // 晶体结构与晶体学
    ("crystal", "晶体"),
    ("crystalline", "晶态"),
    ("amorphous", "非晶态"),
    ("polycrystalline", "多晶"),
    ("single crystal", "单晶"),
    ("crystal structure", "晶体结构"),
    ("lattice", "晶格"),
    ("unit cell", "晶胞"),
    ("lattice parameter", "晶格常数"),
    ("crystallography", "晶体学"),
    ("Miller indices", "密勒指数"),
    ("Bravais lattice", "布拉维点阵"),
    ("body-centered cubic", "体心立方"),
    ("face-centered cubic", "面心立方"),
    ("hexagonal close-packed", "密排六方"),
    ("close-packed", "密排"),
    ("coordination number", "配位数"),
    ("atomic packing factor", "原子堆积因子"),
    ("interstitial", "间隙"),
    ("substitutional", "置换"),
    ("solid solution", "固溶体"),
    ("alloy", "合金"),
    ("phase", "相"),
    ("grain", "晶粒"),
    ("grain boundary", "晶界"),
    ("grain size", "晶粒尺寸"),
    ("texture", "织构"),
    ("anisotropy", "各向异性"),
    ("isotropy", "各向同性"),
    ("polymorphism", "多晶型"),
    ("allotropy", "同素异构"),
    ("crystallinity", "结晶度"),
    ("crystal plane", "晶面"),
    ("crystal direction", "晶向"),
    ("interplanar spacing", "晶面间距"),
    ("Bragg's law", "布拉格定律"),
    ("diffraction", "衍射"),
    ("reciprocal lattice", "倒易点阵"),
    ("Brillouin zone", "布里渊区"),
    // 晶体缺陷
    ("defect", "缺陷"),
    ("point defect", "点缺陷"),
    ("vacancy", "空位"),
    ("interstitial atom", "间隙原子"),
    ("substitutional atom", "置换原子"),
    ("dislocation", "位错"),
    ("edge dislocation", "刃型位错"),
    ("screw dislocation", "螺型位错"),
    ("mixed dislocation", "混合位错"),
    ("Burgers vector", "伯格斯矢量"),
    ("line defect", "线缺陷"),
    ("planar defect", "面缺陷"),
    ("stacking fault", "层错"),
    ("twin", "孪晶"),
    ("twin boundary", "孪晶界"),
    ("void", "空洞"),
    ("pore", "孔隙"),
    ("inclusion", "夹杂物"),
    ("precipitate", "析出相"),
    ("dislocation density", "位错密度"),
    ("slip", "滑移"),
    ("slip system", "滑移系"),
    ("slip plane", "滑移面"),
    ("climb", "攀移"),
    ("cross slip", "交滑移"),
    ("work hardening", "加工硬化"),
    ("strain hardening", "应变硬化"),
    // 扩散
    ("diffusion", "扩散"),
    ("self-diffusion", "自扩散"),
    ("interdiffusion", "互扩散"),
    ("diffusion coefficient", "扩散系数"),
    ("diffusivity", "扩散率"),
    ("Fick's law", "菲克定律"),
    ("activation energy", "激活能"),
    ("vacancy diffusion", "空位扩散"),
    ("interstitial diffusion", "间隙扩散"),
    ("grain boundary diffusion", "晶界扩散"),
    ("surface diffusion", "表面扩散"),
    ("Kirkendall effect", "柯肯达尔效应"),
    ("diffusion barrier", "扩散势垒"),
    // 相图与相变
    ("phase diagram", "相图"),
    ("phase transformation", "相变"),
    ("phase transition", "相变"),
    ("equilibrium", "平衡"),
    ("phase equilibrium", "相平衡"),
    ("Gibbs free energy", "吉布斯自由能"),
    ("free energy", "自由能"),
    ("entropy", "熵"),
    ("enthalpy", "焓"),
    ("chemical potential", "化学势"),
    ("lever rule", "杠杆定律"),
    ("tie line", "共轭线"),
    ("liquidus", "液相线"),
    ("solidus", "固相线"),
    ("solvus", "固溶线"),
    ("eutectic", "共晶"),
    ("eutectoid", "共析"),
    ("peritectic", "包晶"),
    ("peritectoid", "包析"),
    ("monotectic", "偏晶"),
    ("hypoeutectic", "亚共晶"),
    ("hypereutectic", "过共晶"),
    ("solidification", "凝固"),
    ("nucleation", "形核"),
    ("homogeneous nucleation", "均匀形核"),
    ("heterogeneous nucleation", "非均匀形核"),
    ("grain growth", "晶粒长大"),
    ("recrystallization", "再结晶"),
    ("recovery", "回复"),
    ("undercooling", "过冷"),
    ("supercooling", "过冷"),
    ("supersaturation", "过饱和"),
    ("spinodal decomposition", "调幅分解"),
    ("martensitic transformation", "马氏体相变"),
    ("martensite", "马氏体"),
    ("austenite", "奥氏体"),
    ("ferrite", "铁素体"),
    ("cementite", "渗碳体"),
    ("pearlite", "珠光体"),
    ("bainite", "贝氏体"),
    ("ledeburite", "莱氏体"),
    ("sorbite", "索氏体"),
    ("troostite", "屈氏体"),
    ("proeutectoid", "先共析"),
    ("dendrite", "枝晶"),
    ("segregation", "偏析"),
    ("coring", "晶内偏析"),
    ("homogenization", "均匀化"),
    ("aging", "时效"),
    ("precipitation hardening", "析出强化"),
    ("age hardening", "时效硬化"),
    ("ordering", "有序化"),
    ("superlattice", "超晶格"),
    // 力学性能
    ("stress", "应力"),
    ("strain", "应变"),
    ("normal stress", "正应力"),
    ("shear stress", "切应力"),
    ("tensile stress", "拉应力"),
    ("compressive stress", "压应力"),
    ("elastic", "弹性"),
    ("elasticity", "弹性"),
    ("elastic modulus", "弹性模量"),
    ("Young's modulus", "杨氏模量"),
    ("shear modulus", "剪切模量"),
    ("bulk modulus", "体积模量"),
    ("Poisson's ratio", "泊松比"),
    ("plastic", "塑性"),
    ("plasticity", "塑性"),
    ("plastic deformation", "塑性变形"),
    ("elastic deformation", "弹性变形"),
    ("yield", "屈服"),
    ("yield strength", "屈服强度"),
    ("yield point", "屈服点"),
    ("tensile strength", "抗拉强度"),
    ("ultimate tensile strength", "极限抗拉强度"),
    ("compressive strength", "抗压强度"),
    ("shear strength", "抗剪强度"),
    ("fracture strength", "断裂强度"),
    ("ductility", "延展性"),
    ("brittleness", "脆性"),
    ("brittle fracture", "脆性断裂"),
    ("ductile fracture", "韧性断裂"),
    ("toughness", "韧性"),
    ("fracture toughness", "断裂韧性"),
    ("hardness", "硬度"),
    ("hardenability", "淬透性"),
    ("stiffness", "刚度"),
    ("strength", "强度"),
    ("fatigue", "疲劳"),
    ("fatigue limit", "疲劳极限"),
    ("fatigue life", "疲劳寿命"),
    ("creep", "蠕变"),
    ("creep rate", "蠕变速率"),
    ("stress rupture", "应力断裂"),
    ("wear", "磨损"),
    ("abrasion", "磨粒磨损"),
    ("erosion", "冲蚀"),
    ("friction", "摩擦"),
    ("coefficient of friction", "摩擦系数"),
    ("resilience", "弹性比功"),
    ("strain energy", "应变能"),
    ("necking", "颈缩"),
    ("elongation", "延伸率"),
    ("reduction of area", "断面收缩率"),
    ("true stress", "真应力"),
    ("true strain", "真应变"),
    ("engineering stress", "工程应力"),
    ("engineering strain", "工程应变"),
    ("stress concentration", "应力集中"),
    ("stress intensity factor", "应力强度因子"),
    ("crack", "裂纹"),
    ("crack propagation", "裂纹扩展"),
    ("crack tip", "裂纹尖端"),
    ("fracture", "断裂"),
    ("fracture mechanics", "断裂力学"),
    ("Griffith theory", "格里菲斯理论"),
    ("dislocation motion", "位错运动"),
    ("Peierls stress", "派尔斯应力"),
    ("solid solution strengthening", "固溶强化"),
    ("dispersion strengthening", "弥散强化"),
    ("grain refinement", "晶粒细化"),
    ("strengthening", "强化"),
    ("toughening", "增韧"),
    ("superplasticity", "超塑性"),
    ("viscoelasticity", "粘弹性"),
    ("damping", "阻尼"),
    ("impact strength", "冲击强度"),
    ("impact toughness", "冲击韧性"),
    // 热处理
    ("heat treatment", "热处理"),
    ("annealing", "退火"),
    ("quenching", "淬火"),
    ("tempering", "回火"),
    ("normalizing", "正火"),
    ("austenitizing", "奥氏体化"),
    ("stress relief", "去应力"),
    ("spheroidizing", "球化"),
    ("recrystallization annealing", "再结晶退火"),
    ("full annealing", "完全退火"),
    ("isothermal annealing", "等温退火"),
    ("solution treatment", "固溶处理"),
    ("solutionizing", "固溶"),
    ("precipitation", "析出"),
    ("carburizing", "渗碳"),
    ("nitriding", "渗氮"),
    ("carbonitriding", "碳氮共渗"),
    ("boriding", "渗硼"),
    ("surface hardening", "表面硬化"),
    ("induction hardening", "感应淬火"),
    ("flame hardening", "火焰淬火"),
    ("laser hardening", "激光淬火"),
    ("case hardening", "渗碳硬化"),
    ("through hardening", "整体淬火"),
    ("temper brittleness", "回火脆性"),
    ("quench cracking", "淬火裂纹"),
    ("retained austenite", "残余奥氏体"),
    ("cooling rate", "冷却速率"),
    ("heating rate", "加热速率"),
    ("holding time", "保温时间"),
    ("soaking", "保温"),
    ("TTT diagram", "等温转变图"),
    ("CCT diagram", "连续冷却转变图"),
    ("critical cooling rate", "临界冷却速率"),
    ("Jominy test", "末端淬火试验"),
    // 表征与测试
    ("characterization", "表征"),
    ("microscopy", "显微术"),
    ("optical microscopy", "光学显微术"),
    ("electron microscopy", "电子显微术"),
    ("scanning electron microscopy", "扫描电子显微术"),
    ("SEM", "扫描电镜"),
    ("transmission electron microscopy", "透射电子显微术"),
    ("TEM", "透射电镜"),
    ("atomic force microscopy", "原子力显微术"),
    ("AFM", "原子力显微镜"),
    ("scanning probe microscopy", "扫描探针显微术"),
    ("X-ray diffraction", "X射线衍射"),
    ("XRD", "X射线衍射"),
    ("X-ray photoelectron spectroscopy", "X射线光电子能谱"),
    ("XPS", "X射线光电子能谱"),
    ("energy dispersive spectroscopy", "能量色散谱"),
    ("EDS", "能谱"),
    ("electron backscatter diffraction", "电子背散射衍射"),
    ("EBSD", "电子背散射衍射"),
    ("spectroscopy", "能谱"),
    ("infrared spectroscopy", "红外光谱"),
    ("FTIR", "傅里叶变换红外光谱"),
    ("Raman spectroscopy", "拉曼光谱"),
    ("Raman", "拉曼"),
    ("nuclear magnetic resonance", "核磁共振"),
    ("NMR", "核磁共振"),
    ("mass spectrometry", "质谱"),
    ("thermal analysis", "热分析"),
    ("differential scanning calorimetry", "差示扫描量热法"),
    ("DSC", "差示扫描量热法"),
    ("thermogravimetric analysis", "热重分析"),
    ("TGA", "热重分析"),
    ("differential thermal analysis", "差热分析"),
    ("DTA", "差热分析"),
    ("dynamic mechanical analysis", "动态力学分析"),
    ("DMA", "动态力学分析"),
    ("dilatometry", "膨胀法"),
    ("metallography", "金相学"),
    ("metallographic", "金相的"),
    ("etching", "浸蚀"),
    ("polishing", "抛光"),
    ("grinding", "磨光"),
    ("sample preparation", "样品制备"),
    ("micrograph", "显微照片"),
    ("microstructure", "显微组织"),
    ("nanostructure", "纳米结构"),
    ("morphology", "形貌"),
    ("topography", "表面形貌"),
    ("porosity", "孔隙率"),
    ("density", "密度"),
    ("specific surface area", "比表面积"),
    ("BET", "比表面积"),
    ("particle size", "粒径"),
    ("tensile test", "拉伸试验"),
    ("compression test", "压缩试验"),
    ("hardness test", "硬度试验"),
    ("Brinell hardness", "布氏硬度"),
    ("Rockwell hardness", "洛氏硬度"),
    ("Vickers hardness", "维氏硬度"),
    ("Knoop hardness", "努氏硬度"),
    ("Mohs hardness", "莫氏硬度"),
    ("Charpy impact", "夏比冲击"),
    ("Izod impact", "悬臂梁冲击"),
    ("fatigue test", "疲劳试验"),
    ("creep test", "蠕变试验"),
    ("nanoindentation", "纳米压痕"),
    ("indentation", "压痕"),
    ("scratch test", "划痕试验"),
    // 金属与合金
    ("metal", "金属"),
    ("ferrous", "铁基"),
    ("nonferrous", "有色"),
    ("steel", "钢"),
    ("stainless steel", "不锈钢"),
    ("carbon steel", "碳钢"),
    ("alloy steel", "合金钢"),
    ("tool steel", "工具钢"),
    ("cast iron", "铸铁"),
    ("gray cast iron", "灰口铸铁"),
    ("ductile cast iron", "球墨铸铁"),
    ("white cast iron", "白口铸铁"),
    ("wrought iron", "熟铁"),
    ("aluminum", "铝"),
    ("aluminium", "铝"),
    ("copper", "铜"),
    ("titanium", "钛"),
    ("nickel", "镍"),
    ("magnesium", "镁"),
    ("zinc", "锌"),
    ("chromium", "铬"),
    ("manganese", "锰"),
    ("molybdenum", "钼"),
    ("tungsten", "钨"),
    ("vanadium", "钒"),
    ("niobium", "铌"),
    ("cobalt", "钴"),
    ("iron", "铁"),
    ("carbon", "碳"),
    ("silicon", "硅"),
    ("brass", "黄铜"),
    ("bronze", "青铜"),
    ("superalloy", "高温合金"),
    ("nickel-based superalloy", "镍基高温合金"),
    ("titanium alloy", "钛合金"),
    ("aluminum alloy", "铝合金"),
    ("shape memory alloy", "形状记忆合金"),
    ("high entropy alloy", "高熵合金"),
    ("amorphous alloy", "非晶合金"),
    ("metallic glass", "金属玻璃"),
    ("intermetallic", "金属间化合物"),
    ("solder", "钎料"),
    ("brazing", "钎焊"),
    // 陶瓷与无机非金属
    ("ceramic", "陶瓷"),
    ("glass", "玻璃"),
    ("glass-ceramic", "微晶玻璃"),
    ("refractory", "耐火材料"),
    ("alumina", "氧化铝"),
    ("zirconia", "氧化锆"),
    ("silica", "二氧化硅"),
    ("silicon carbide", "碳化硅"),
    ("silicon nitride", "氮化硅"),
    ("boron carbide", "碳化硼"),
    ("boron nitride", "氮化硼"),
    ("titanium carbide", "碳化钛"),
    ("tungsten carbide", "碳化钨"),
    ("cemented carbide", "硬质合金"),
    ("porcelain", "瓷"),
    ("clay", "黏土"),
    ("sintering", "烧结"),
    ("solid state sintering", "固相烧结"),
    ("liquid phase sintering", "液相烧结"),
    ("hot pressing", "热压"),
    ("hot isostatic pressing", "热等静压"),
    ("HIP", "热等静压"),
    ("spark plasma sintering", "放电等离子烧结"),
    ("SPS", "放电等离子烧结"),
    ("green body", "生坯"),
    ("binder", "粘结剂"),
    ("densification", "致密化"),
    ("vitrification", "玻化"),
    ("glaze", "釉"),
    ("enamel", "搪瓷"),
    ("piezoelectric", "压电"),
    ("ferroelectric", "铁电"),
    ("dielectric", "电介质"),
    ("superconductor", "超导体"),
    ("superconductivity", "超导电性"),
    ("semiconductor", "半导体"),
    ("band gap", "带隙"),
    ("doping", "掺杂"),
    ("dopant", "掺杂剂"),
    // 高分子
    ("polymer", "聚合物"),
    ("polymerization", "聚合"),
    ("addition polymerization", "加聚"),
    ("condensation polymerization", "缩聚"),
    ("monomer", "单体"),
    ("copolymer", "共聚物"),
    ("homopolymer", "均聚物"),
    ("block copolymer", "嵌段共聚物"),
    ("graft copolymer", "接枝共聚物"),
    ("thermoplastic", "热塑性"),
    ("thermoset", "热固性"),
    ("thermosetting", "热固性"),
    ("elastomer", "弹性体"),
    ("rubber", "橡胶"),
    ("plastic", "塑料"),
    ("resin", "树脂"),
    ("epoxy", "环氧"),
    ("epoxy resin", "环氧树脂"),
    ("polyethylene", "聚乙烯"),
    ("polypropylene", "聚丙烯"),
    ("polystyrene", "聚苯乙烯"),
    ("polyvinyl chloride", "聚氯乙烯"),
    ("PVC", "聚氯乙烯"),
    ("polytetrafluoroethylene", "聚四氟乙烯"),
    ("PTFE", "聚四氟乙烯"),
    ("nylon", "尼龙"),
    ("polyamide", "聚酰胺"),
    ("polyester", "聚酯"),
    ("polycarbonate", "聚碳酸酯"),
    ("polymethyl methacrylate", "聚甲基丙烯酸甲酯"),
    ("PMMA", "有机玻璃"),
    ("polyurethane", "聚氨酯"),
    ("silicone", "有机硅"),
    ("molecular weight", "分子量"),
    ("number average molecular weight", "数均分子量"),
    ("weight average molecular weight", "重均分子量"),
    ("molecular weight distribution", "分子量分布"),
    ("polydispersity", "多分散性"),
    ("degree of polymerization", "聚合度"),
    ("glass transition", "玻璃化转变"),
    ("glass transition temperature", "玻璃化转变温度"),
    ("melting temperature", "熔融温度"),
    ("melting point", "熔点"),
    ("crystallization", "结晶"),
    ("crosslinking", "交联"),
    ("crosslink", "交联"),
    ("crosslink density", "交联密度"),
    ("curing", "固化"),
    ("vulcanization", "硫化"),
    ("polymer chain", "高分子链"),
    ("backbone", "主链"),
    ("side group", "侧基"),
    ("tacticity", "立构规整性"),
    ("isotactic", "全同立构"),
    ("syndiotactic", "间同立构"),
    ("atactic", "无规"),
    ("amorphous region", "非晶区"),
    ("crystalline region", "结晶区"),
    ("spherulite", "球晶"),
    ("lamella", "片晶"),
    ("entanglement", "缠结"),
    ("plasticizer", "增塑剂"),
    ("filler", "填料"),
    ("additive", "添加剂"),
    ("stabilizer", "稳定剂"),
    ("antioxidant", "抗氧剂"),
    ("flame retardant", "阻燃剂"),
    ("degradation", "降解"),
    ("biodegradable", "生物可降解"),
    ("viscoelastic", "粘弹性"),
    ("storage modulus", "储能模量"),
    ("loss modulus", "损耗模量"),
    ("tan delta", "损耗因子"),
    ("melt flow index", "熔体流动指数"),
    ("extrusion", "挤出"),
    ("injection molding", "注塑"),
    ("blow molding", "吹塑"),
    ("thermoforming", "热成型"),
    ("compression molding", "模压"),
    // 复合材料
    ("composite", "复合材料"),
    ("composite material", "复合材料"),
    ("matrix", "基体"),
    ("reinforcement", "增强体"),
    ("fiber", "纤维"),
    ("fibre", "纤维"),
    ("carbon fiber", "碳纤维"),
    ("glass fiber", "玻璃纤维"),
    ("aramid fiber", "芳纶纤维"),
    ("boron fiber", "硼纤维"),
    ("whisker", "晶须"),
    ("particulate", "颗粒"),
    ("laminate", "层合板"),
    ("ply", "铺层"),
    ("layup", "铺层"),
    ("prepreg", "预浸料"),
    ("fiber reinforced polymer", "纤维增强聚合物"),
    ("FRP", "纤维增强复合材料"),
    ("carbon fiber reinforced polymer", "碳纤维增强复合材料"),
    ("CFRP", "碳纤维增强复合材料"),
    ("metal matrix composite", "金属基复合材料"),
    ("ceramic matrix composite", "陶瓷基复合材料"),
    ("polymer matrix composite", "聚合物基复合材料"),
    ("interface", "界面"),
    ("interphase", "界面相"),
    ("interfacial bonding", "界面结合"),
    ("debonding", "脱粘"),
    ("delamination", "分层"),
    ("fiber pull-out", "纤维拔出"),
    ("rule of mixtures", "混合律"),
    ("specific strength", "比强度"),
    ("specific modulus", "比模量"),
    ("sandwich structure", "夹层结构"),
    ("honeycomb", "蜂窝"),
    ("core", "芯材"),
    ("skin", "蒙皮"),
    ("void content", "孔隙含量"),
    ("fiber volume fraction", "纤维体积分数"),
    ("wetting", "润湿"),
    ("wettability", "润湿性"),
    ("sizing", "上浆剂"),
    ("coupling agent", "偶联剂"),
    // 纳米材料与薄膜
    ("nanomaterial", "纳米材料"),
    ("nanoparticle", "纳米颗粒"),
    ("nanotechnology", "纳米技术"),
    ("nanoscale", "纳米尺度"),
    ("nanometer", "纳米"),
    ("carbon nanotube", "碳纳米管"),
    ("CNT", "碳纳米管"),
    ("single-walled carbon nanotube", "单壁碳纳米管"),
    ("multi-walled carbon nanotube", "多壁碳纳米管"),
    ("graphene", "石墨烯"),
    ("graphene oxide", "氧化石墨烯"),
    ("reduced graphene oxide", "还原氧化石墨烯"),
    ("fullerene", "富勒烯"),
    ("quantum dot", "量子点"),
    ("nanowire", "纳米线"),
    ("nanorod", "纳米棒"),
    ("nanofiber", "纳米纤维"),
    ("nanosheet", "纳米片"),
    ("nanofilm", "纳米薄膜"),
    ("thin film", "薄膜"),
    ("nanocomposite", "纳米复合材料"),
    ("nanocluster", "纳米团簇"),
    ("nanocrystal", "纳米晶"),
    ("quantum confinement", "量子限域"),
    ("surface plasmon", "表面等离激元"),
    ("self-assembly", "自组装"),
    ("bottom-up", "自下而上"),
    ("top-down", "自上而下"),
    ("sol-gel", "溶胶-凝胶"),
    ("chemical vapor deposition", "化学气相沉积"),
    ("CVD", "化学气相沉积"),
    ("physical vapor deposition", "物理气相沉积"),
    ("PVD", "物理气相沉积"),
    ("atomic layer deposition", "原子层沉积"),
    ("ALD", "原子层沉积"),
    ("sputtering", "溅射"),
    ("evaporation", "蒸镀"),
    ("epitaxy", "外延"),
    ("molecular beam epitaxy", "分子束外延"),
    ("lithography", "光刻"),
    ("MEMS", "微机电系统"),
    // 腐蚀与防护
    ("corrosion", "腐蚀"),
    ("oxidation", "氧化"),
    ("reduction", "还原"),
    ("rust", "铁锈"),
    ("galvanic corrosion", "电偶腐蚀"),
    ("pitting corrosion", "点蚀"),
    ("crevice corrosion", "缝隙腐蚀"),
    ("intergranular corrosion", "晶间腐蚀"),
    ("stress corrosion cracking", "应力腐蚀开裂"),
    ("SCC", "应力腐蚀开裂"),
    ("corrosion fatigue", "腐蚀疲劳"),
    ("erosion corrosion", "冲刷腐蚀"),
    ("uniform corrosion", "均匀腐蚀"),
    ("passivation", "钝化"),
    ("passive film", "钝化膜"),
    ("cathodic protection", "阴极保护"),
    ("anodic protection", "阳极保护"),
    ("sacrificial anode", "牺牲阳极"),
    ("coating", "涂层"),
    ("electroplating", "电镀"),
    ("anodizing", "阳极氧化"),
    ("corrosion resistance", "耐蚀性"),
    ("oxidation resistance", "抗氧化性"),
    ("high temperature oxidation", "高温氧化"),
    ("protective layer", "保护层"),
    // 加工与制造
    ("casting", "铸造"),
    ("sand casting", "砂型铸造"),
    ("die casting", "压铸"),
    ("investment casting", "熔模铸造"),
    ("continuous casting", "连铸"),
    ("forging", "锻造"),
    ("rolling", "轧制"),
    ("hot rolling", "热轧"),
    ("cold rolling", "冷轧"),
    ("drawing", "拉拔"),
    ("stamping", "冲压"),
    ("forming", "成形"),
    ("machining", "机械加工"),
    ("welding", "焊接"),
    ("arc welding", "电弧焊"),
    ("laser welding", "激光焊接"),
    ("friction stir welding", "搅拌摩擦焊"),
    ("FSW", "搅拌摩擦焊"),
    ("additive manufacturing", "增材制造"),
    ("3D printing", "3D打印"),
    ("selective laser melting", "选区激光熔化"),
    ("SLM", "选区激光熔化"),
    ("powder metallurgy", "粉末冶金"),
    ("atomization", "雾化"),
    ("compaction", "压制"),
    ("cold working", "冷加工"),
    ("hot working", "热加工"),
    ("surface treatment", "表面处理"),
    ("shot peening", "喷丸"),
    ("sandblasting", "喷砂"),
    ("pickling", "酸洗"),
    ("degreasing", "脱脂"),
    // 物理性能
    ("thermal conductivity", "热导率"),
    ("electrical conductivity", "电导率"),
    ("electrical resistivity", "电阻率"),
    ("thermal expansion", "热膨胀"),
    ("coefficient of thermal expansion", "热膨胀系数"),
    ("CTE", "热膨胀系数"),
    ("specific heat", "比热"),
    ("heat capacity", "热容"),
    ("boiling point", "沸点"),
    ("magnetization", "磁化"),
    ("ferromagnetic", "铁磁性"),
    ("paramagnetic", "顺磁性"),
    ("diamagnetic", "抗磁性"),
    ("antiferromagnetic", "反铁磁性"),
    ("Curie temperature", "居里温度"),
    ("coercivity", "矫顽力"),
    ("remanence", "剩磁"),
    ("permeability", "磁导率"),
    ("hysteresis", "磁滞"),
    ("hysteresis loop", "磁滞回线"),
    ("refractive index", "折射率"),
    ("transparency", "透明性"),
    ("absorbance", "吸光度"),
    ("luminescence", "发光"),
    ("fluorescence", "荧光"),
    ("phosphorescence", "磷光"),
    ("photoluminescence", "光致发光"),
    ("band structure", "能带结构"),
    ("valence band", "价带"),
    ("conduction band", "导带"),
    ("Fermi level", "费米能级"),
    ("work function", "功函数"),
    ("dielectric constant", "介电常数"),
    ("permittivity", "电容率"),
    ("piezoelectricity", "压电性"),
    ("thermoelectric", "热电"),
    ("Seebeck coefficient", "塞贝克系数"),
    ("ionic conductivity", "离子电导率"),
    ("superhydrophobic", "超疏水"),
    ("hydrophilic", "亲水"),
    ("hydrophobic", "疏水"),
];

#[cfg(target_arch = "wasm32")]
#[plugin_fn]
pub fn translate(input: String) -> FnResult<String> {
    Ok(translate_json(&input)?)
}

fn translate_json(input: &str) -> Result<String, serde_json::Error> {
    let value: Value = serde_json::from_str(input)?;
    let raw = value.get("raw").and_then(|v| v.as_str()).unwrap_or("");
    let out = translate_text(raw);
    Ok(serde_json::json!({ "result": out }).to_string())
}

// 单遍贪心最长匹配：在每个词起点优先匹配最长术语，避免 "yield strength" 被 "strength" 抢先替换。
fn translate_text(text: &str) -> String {
    let mut terms: Vec<&(&str, &str)> = GLOSSARY.iter().collect();
    terms.sort_by(|a, b| b.0.len().cmp(&a.0.len()).then_with(|| a.0.cmp(b.0)));
    let bytes = text.as_bytes();
    let mut result = String::with_capacity(text.len());
    let mut i = 0usize;
    while i < text.len() {
        let prev_word = text[..i]
            .chars()
            .next_back()
            .map(|c| c.is_ascii_alphanumeric() || c == '_')
            .unwrap_or(false);
        let mut matched = None;
        if !prev_word && bytes[i].is_ascii_alphanumeric() {
            for &(en, zh) in &terms {
                if let Some(len) = match_term(bytes, i, en) {
                    matched = Some((len, zh));
                    break;
                }
            }
        }
        if let Some((len, zh)) = matched {
            result.push_str(zh);
            i += len;
        } else {
            let ch = text[i..].chars().next().unwrap();
            result.push(ch);
            i += ch.len_utf8();
        }
    }
    result
}

fn is_word_byte(b: u8) -> bool {
    b.is_ascii_alphanumeric() || b == b'_'
}

// 大小写不敏感匹配；术语内部空格可对应文本中任意连续空白（含换行）；
// 词尾可选复数 s/es；匹配两端必须落在词边界上，避免误伤 stressful 之类。
fn match_term(bytes: &[u8], start: usize, term: &str) -> Option<usize> {
    let tb = term.as_bytes();
    let mut ti = start;
    let mut j = 0;
    while j < tb.len() {
        if tb[j] == b' ' {
            if ti >= bytes.len() || !bytes[ti].is_ascii_whitespace() {
                return None;
            }
            while ti < bytes.len() && bytes[ti].is_ascii_whitespace() {
                ti += 1;
            }
            j += 1;
        } else {
            if ti >= bytes.len() || !bytes[ti].eq_ignore_ascii_case(&tb[j]) {
                return None;
            }
            ti += 1;
            j += 1;
        }
    }
    let mut end = ti;
    if end < bytes.len()
        && bytes[end] == b's'
        && (end + 1 >= bytes.len() || !is_word_byte(bytes[end + 1]))
    {
        end += 1;
    } else if end + 1 < bytes.len()
        && bytes[end] == b'e'
        && bytes[end + 1] == b's'
        && (end + 2 >= bytes.len() || !is_word_byte(bytes[end + 2]))
    {
        end += 2;
    }
    if end < bytes.len() && is_word_byte(bytes[end]) {
        return None;
    }
    Some(end - start)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn replaces_basic_term() {
        assert_eq!(translate_text("The dislocation moves."), "The 位错 moves.");
    }

    #[test]
    fn case_insensitive() {
        assert_eq!(translate_text("DISLOCATION and Dislocation"), "位错 and 位错");
    }

    #[test]
    fn longest_match_wins() {
        assert_eq!(translate_text("yield strength"), "屈服强度");
        assert_eq!(translate_text("carbon nanotube"), "碳纳米管");
        assert_eq!(translate_text("glass transition temperature"), "玻璃化转变温度");
    }

    #[test]
    fn word_boundary_respected() {
        assert_eq!(translate_text("stressful"), "stressful");
        assert_eq!(translate_text("restress"), "restress");
        assert_eq!(translate_text("stress"), "应力");
    }

    #[test]
    fn plural_forms() {
        assert_eq!(translate_text("dislocations"), "位错");
        assert_eq!(translate_text("alloys"), "合金");
        assert_eq!(translate_text("stresses"), "应力");
    }

    #[test]
    fn flexible_whitespace() {
        assert_eq!(translate_text("yield\nstrength"), "屈服强度");
        assert_eq!(translate_text("grain  boundary"), "晶界");
    }

    #[test]
    fn mixed_sentence() {
        let out = translate_text("The yield strength of the steel increases after quenching.");
        assert_eq!(out, "The 屈服强度 of the 钢 increases after 淬火.");
    }

    #[test]
    fn preserves_non_ascii() {
        assert_eq!(translate_text("已有中文 dislocation 结尾"), "已有中文 位错 结尾");
    }

    #[test]
    fn translate_contract() {
        let input = serde_json::json!({ "raw": "tensile strength", "targetLang": "zh" }).to_string();
        let out = translate_json(&input).unwrap();
        let value: Value = serde_json::from_str(&out).unwrap();
        assert_eq!(value["result"], "抗拉强度");
    }
}
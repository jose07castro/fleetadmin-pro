package com.jose07castro.fleetadminpro;

import java.util.ArrayList;
import java.util.Collections;
import java.util.List;

/**
 * Base de datos oficial de cámaras de fotomultas y radares fijos de Rosario
 * y Av. Circunvalación (80 puntos GPS oficiales WGS84).
 * Sincronizado exactamente con CopilotModule (copilot.js).
 */
public class RosarioRadars {

    public static class StaticRadar {
        public final String id;
        public final String name;
        public final double lat;
        public final double lng;
        public final int limit;
        public final String desc;

        public StaticRadar(String id, String name, double lat, double lng, int limit, String desc) {
            this.id = id;
            this.name = name;
            this.lat = lat;
            this.lng = lng;
            this.limit = limit;
            this.desc = desc;
        }
    }

    public static final List<StaticRadar> ALL_RADARS;

    static {
        List<StaticRadar> list = new ArrayList<>(80);
        list.add(new StaticRadar("radar_rosario_1", "España y San Lorenzo", -32.942635, -60.645948, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_2", "Mendoza y Av. Provincias Unidas", -32.940218, -60.712617, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_3", "Laprida 850", -32.947905, -60.634233, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_4", "Necochea 2650", -32.970673, -60.629809, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_5", "Ayacucho y Av. Arijón", -33.002625, -60.636058, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_6", "Maipú y Mendoza", -32.952, -60.63655, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_7", "Córdoba y Av. Ovidio Lagos", -32.942251, -60.661437, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_8", "Santa Fe y Pueyrredón", -32.941639, -60.657014, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_9", "Santa Fe 1750", -32.943309, -60.64682, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_10", "Laprida y 3 de Febrero", -32.953483, -60.635702, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_11", "San Lorenzo 1550", -32.94287, -60.643818, 40, "Cruce en rojo / Senda peatonal"));
        list.add(new StaticRadar("radar_rosario_12", "Colombres 1071", -32.902573, -60.681992, 50, "Totem disuasorio."));
        list.add(new StaticRadar("radar_rosario_13", "Colombres 930", -32.903665, -60.679356, 50, "Tótem disuasorio de velocidad"));
        list.add(new StaticRadar("radar_rosario_14", "Frondizi 260", -32.91085, -60.676757, 50, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_15", "Bv. Rondeau y Baigorria", -32.891534, -60.693321, 50, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_16", "Mendoza y Bv. Avellaneda", -32.944206, -60.680413, 50, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_17", "Cafferata 850", -32.941091, -60.671253, 50, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_18", "Mendoza 5350", -32.941184, -60.69654, 50, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_19", "Colombres 1451", -32.89803, -60.684388, 50, "Invasión de ciclovía"));
        list.add(new StaticRadar("radar_rosario_20", "Córdoba 3050", -32.941517, -60.664756, 50, "Invación carril exclusivo"));
        list.add(new StaticRadar("radar_rosario_21", "Santa Fe 2850", -32.94065, -60.661745, 50, "Invasión carril exclusivo"));
        list.add(new StaticRadar("radar_rosario_22", "Av. Arijón 750", -33.002789, -60.645956, 60, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_23", "Av. Belgrano 2131 - Sur-Norte", -32.96665, -60.621018, 60, "Exceso de velocidad"));
        list.add(new StaticRadar("radar_rosario_24", "Casiano Casas y Sorrento", -32.907258, -60.695756, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_25", "Av. Eva Perón y Circunvalación (Colectora)", -32.931398, -60.721774, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_26", "Av. Estanislao López y Av. Francia", -32.925269, -60.66138, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_27", "Juan José Paso y Cullen", -32.920183, -60.709713, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_28", "Av. Pellegrini y Gutenberg", -32.948475, -60.690025, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_29", "Av. Provincias Unidas y Av. Pellegrini", -32.948576, -60.712266, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_30", "Av. Pellegrini y Av. Ovidio Lagos", -32.953098, -60.66419, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_31", "Bv. Oroño y Bv. Seguí", -32.97636, -60.661512, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_32", "Av. Pellegrini y Rouillón", -32.948301, -60.70193, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_33", "Av. Presidente Perón y Rouillón", -32.962875, -60.701377, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_34", "Av. Travesía (Sabin) y Bv. Avellaneda", -32.928855, -60.676595, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_35", "Av. Uriburu y Bv. Avellaneda", -32.991941, -60.688768, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_36", "Bv. Rondeau 1250", -32.90174, -60.689834, 60, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_37", "Av. Pellegrini 1551", -32.956361, -60.647227, 60, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_38", "Av. Provincias Unidas 750", -32.936316, -60.713057, 60, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_39", "Av. Provincias Unidas 2550", -32.958707, -60.712083, 60, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_40", "Bv. Oroño 2170", -32.960032, -60.657712, 60, "Tótem disuasorio de velocidad"));
        list.add(new StaticRadar("radar_rosario_41", "Av. Estanislao López 2530", -32.928495, -60.65454, 60, "Tótem disuasorio de velocidad"));
        list.add(new StaticRadar("radar_rosario_42", "Av. Belgrano 181 Bis", -32.957185, -60.622465, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_43", "Av. Estanislao López 2531", -32.928745, -60.654986, 60, "Exceso de velocidad"));
        list.add(new StaticRadar("radar_rosario_44", "Av. Uriburu 1185", -32.991, -60.650593, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_45", "Sorrento 6431", -32.908015, -60.710811, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_46", "Av. 27 de Febrero y Matienzo", -32.958746, -60.693969, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_47", "Av. Jorge Newbery 7915", -32.908616, -60.733412, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_48", "ILLIA PTE. ARTURO U. 1402", -32.937028, -60.639938, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_49", "Bv. Seguí 3820", -32.97219, -60.683506, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_50", "Bv. Avellaneda 2951", -32.964331, -60.685223, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_51", "Sorrento y Circunvalación (Colectora)", -32.908234, -60.722652, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_52", "Av. Ovidio Lagos y Av. Arijón", -33.003837, -60.676165, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_53", "Av. 27 de Febrero y Av. Francia", -32.962699, -60.670855, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_54", "Bv. Avellaneda y Av. Carballo", -32.921979, -60.674815, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_55", "Av. Belgrano y Raúl Domínguez", -32.949759, -60.628175, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_56", "Av. Francia y Av. Presidente Perón", -32.955902, -60.669142, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_57", "Av. Pellegrini y Corrientes", -32.956531, -60.645082, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_58", "Bv. Oroño y Av. Uriburu", -32.991421, -60.6654, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_59", "Av. Presidente Perón y Av. Provincias Unidas", -32.967948, -60.711484, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_60", "Av. San Martín y Av. Uriburu", -32.990667, -60.64669, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_61", "Av. Ovidio Lagos 3550", -32.97429, -60.669492, 60, "Invasión ciclovía"));
        list.add(new StaticRadar("radar_rosario_62", "Av. Belgrano 180 Bis", -32.95702, -60.622071, 60, "Tótem disuasorio de velocidad"));
        list.add(new StaticRadar("radar_rosario_63", "Callao y Salta", -32.935521, -60.658315, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_64", "Bv. Rondeau 3860", -32.879559, -60.696588, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_65", "Bv. Rondeau 2941", -32.886461, -60.695243, 60, "Control de Exceso de Velocidad"));
        list.add(new StaticRadar("radar_rosario_66", "Av. Uriburu 3555 Oeste-Este", -32.992058, -60.684454, 60, "Control de Exceso de Velocidad"));
        list.add(new StaticRadar("radar_rosario_67", "Bv. Avellaneda y Santa Fe", -32.937731, -60.678776, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_68", "Bv. Avellaneda y Av. Presidente Perón", -32.957605, -60.683796, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_69", "Av. San Martín y Garibaldi", -32.986372, -60.645762, 60, "Giro Indebido"));
        list.add(new StaticRadar("radar_rosario_70", "Carrasco 3394", -32.883611, -60.687809, 60, "Exceso de velocidad."));
        list.add(new StaticRadar("radar_rosario_71", "Bv. Oroño y Av. 27 de Febrero", -32.964881, -60.658643, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_72", "Bv. Bv. Avellaneda y Bv. Seguí", -32.971724, -60.68736, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_73", "Av. Pellegrini y Bv. Avellaneda", -32.949941, -60.68186, 60, "Cruce en rojo"));
        list.add(new StaticRadar("radar_rosario_74", "Bv. Oroño y Batlle y Ordóñez", -33.009436, -60.664703, 70, "Cruce en rojo"));
        list.add(new StaticRadar("radar_circ_1", "Av. Circunvalación y Av. Pellegrini", -32.9696, -60.7105, 100, "Radar de velocidad fija Circunvalación"));
        list.add(new StaticRadar("radar_circ_2", "Av. Circunvalación y Av. Eva Perón (Córdoba)", -32.9367, -60.7228, 100, "Radar de velocidad fija Circunvalación"));
        list.add(new StaticRadar("radar_circ_3", "Av. Circunvalación y Av. Uriburu", -33.0031, -60.6729, 100, "Radar de velocidad fija Circunvalación"));
        list.add(new StaticRadar("radar_circ_4", "Av. Circunvalación y Ayacucho (Acceso Sur)", -33.0118, -60.6385, 100, "Radar de velocidad fija Circunvalación"));
        list.add(new StaticRadar("radar_circ_5", "Av. Circunvalación y Baigorria", -32.8943, -60.7077, 100, "Radar de velocidad fija Circunvalación"));
        list.add(new StaticRadar("radar_circ_6", "Autopista Rosario - Bs As (Ingreso Av. Circunvalación)", -33.0315, -60.6482, 70, "Radar ingreso a Rosario"));
        ALL_RADARS = Collections.unmodifiableList(list);
    }
}

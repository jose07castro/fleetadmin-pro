package com.jose07castro.fleetadminpro;

import android.content.ContentValues;
import android.content.Context;
import android.database.Cursor;
import android.database.sqlite.SQLiteDatabase;
import android.database.sqlite.SQLiteOpenHelper;
import java.util.ArrayList;
import java.util.List;

public class LocationDbHelper extends SQLiteOpenHelper {
    private static final String DATABASE_NAME = "location_queue.db";
    private static final int DATABASE_VERSION = 1;
    
    public static final String TABLE_NAME = "locations";
    public static final String COLUMN_ID = "id";
    public static final String COLUMN_LAT = "lat";
    public static final String COLUMN_LNG = "lng";
    public static final String COLUMN_SPEED = "speed";
    public static final String COLUMN_BEARING = "bearing";
    public static final String COLUMN_BATTERY = "battery";
    public static final String COLUMN_TIMESTAMP = "timestamp";

    public static class QueuedLocation {
        public int id;
        public double lat;
        public double lng;
        public float speed;
        public float bearing;
        public int battery;
        public String timestamp;

        public QueuedLocation(int id, double lat, double lng, float speed, float bearing, int battery, String timestamp) {
            this.id = id;
            this.lat = lat;
            this.lng = lng;
            this.speed = speed;
            this.bearing = bearing;
            this.battery = battery;
            this.timestamp = timestamp;
        }
    }

    public LocationDbHelper(Context context) {
        super(context, DATABASE_NAME, null, DATABASE_VERSION);
    }

    @Override
    public void onCreate(SQLiteDatabase db) {
        String createTable = "CREATE TABLE " + TABLE_NAME + " (" +
                COLUMN_ID + " INTEGER PRIMARY KEY AUTOINCREMENT, " +
                COLUMN_LAT + " REAL, " +
                COLUMN_LNG + " REAL, " +
                COLUMN_SPEED + " REAL, " +
                COLUMN_BEARING + " REAL, " +
                COLUMN_BATTERY + " INTEGER, " +
                COLUMN_TIMESTAMP + " TEXT)";
        db.execSQL(createTable);
    }

    @Override
    public void onUpgrade(SQLiteDatabase db, int oldVersion, int newVersion) {
        db.execSQL("DROP TABLE IF EXISTS " + TABLE_NAME);
        onCreate(db);
    }

    public synchronized void enqueueLocation(double lat, double lng, float speed, float bearing, int battery, String timestamp) {
        try {
            SQLiteDatabase db = this.getWritableDatabase();
            ContentValues values = new ContentValues();
            values.put(COLUMN_LAT, lat);
            values.put(COLUMN_LNG, lng);
            values.put(COLUMN_SPEED, speed);
            values.put(COLUMN_BEARING, bearing);
            values.put(COLUMN_BATTERY, battery);
            values.put(COLUMN_TIMESTAMP, timestamp);
            db.insert(TABLE_NAME, null, values);

            // Limit queue size to 500 points to prevent bloat
            db.execSQL("DELETE FROM " + TABLE_NAME + " WHERE " + COLUMN_ID + " NOT IN (SELECT " + COLUMN_ID + " FROM " + TABLE_NAME + " ORDER BY " + COLUMN_ID + " DESC LIMIT 500)");
        } catch (Exception e) {
            android.util.Log.e("LocationDbHelper", "Error enqueuing location", e);
        }
    }

    public synchronized void pruneQueue(int maxCount) {
        try {
            SQLiteDatabase db = this.getWritableDatabase();
            db.execSQL("DELETE FROM " + TABLE_NAME + " WHERE " + COLUMN_ID + " NOT IN (SELECT " + COLUMN_ID + " FROM " + TABLE_NAME + " ORDER BY " + COLUMN_ID + " DESC LIMIT " + maxCount + ")");
        } catch (Exception e) {
            android.util.Log.e("LocationDbHelper", "Error pruning queue", e);
        }
    }

    public synchronized List<QueuedLocation> getQueuedLocations() {
        List<QueuedLocation> list = new ArrayList<>();
        Cursor cursor = null;
        try {
            SQLiteDatabase db = this.getReadableDatabase();
            cursor = db.query(TABLE_NAME, null, null, null, null, null, COLUMN_ID + " ASC");
            if (cursor != null && cursor.moveToFirst()) {
                do {
                    int id = cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_ID));
                    double lat = cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LAT));
                    double lng = cursor.getDouble(cursor.getColumnIndexOrThrow(COLUMN_LNG));
                    float speed = cursor.getFloat(cursor.getColumnIndexOrThrow(COLUMN_SPEED));
                    float bearing = cursor.getFloat(cursor.getColumnIndexOrThrow(COLUMN_BEARING));
                    int battery = cursor.getInt(cursor.getColumnIndexOrThrow(COLUMN_BATTERY));
                    String timestamp = cursor.getString(cursor.getColumnIndexOrThrow(COLUMN_TIMESTAMP));
                    list.add(new QueuedLocation(id, lat, lng, speed, bearing, battery, timestamp));
                } while (cursor.moveToNext());
            }
        } catch (Exception e) {
            android.util.Log.e("LocationDbHelper", "Error reading locations", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return list;
    }

    public synchronized void deleteLocation(int id) {
        try {
            SQLiteDatabase db = this.getWritableDatabase();
            db.delete(TABLE_NAME, COLUMN_ID + " = ?", new String[]{String.valueOf(id)});
        } catch (Exception e) {
            android.util.Log.e("LocationDbHelper", "Error deleting location", e);
        }
    }

    /**
     * Elimina entradas de la cola cuyo timestamp sea más antiguo que maxAgeHours horas.
     * Los puntos GPS viejos no tienen sentido enviarlos días después.
     * @param maxAgeHours horas máximas de antigüedad permitida
     * @return cantidad de entradas eliminadas
     */
    public synchronized int clearOldEntries(int maxAgeHours) {
        try {
            SQLiteDatabase db = this.getWritableDatabase();
            // Calcular timestamp ISO mínimo aceptable
            long cutoffMs = System.currentTimeMillis() - ((long) maxAgeHours * 60 * 60 * 1000);
            java.text.SimpleDateFormat sdf = new java.text.SimpleDateFormat("yyyy-MM-dd'T'HH:mm:ss.SSS'Z'", java.util.Locale.US);
            sdf.setTimeZone(java.util.TimeZone.getTimeZone("UTC"));
            String cutoffStr = sdf.format(new java.util.Date(cutoffMs));

            int deleted = db.delete(TABLE_NAME, COLUMN_TIMESTAMP + " < ?", new String[]{cutoffStr});
            if (deleted > 0) {
                android.util.Log.i("LocationDbHelper", "🗑️ Cola GPS: " + deleted + " puntos viejos (>" + maxAgeHours + "h) eliminados.");
            }
            return deleted;
        } catch (Exception e) {
            android.util.Log.e("LocationDbHelper", "Error clearing old entries", e);
            return 0;
        }
    }

    public synchronized int getQueueSize() {
        Cursor cursor = null;
        try {
            SQLiteDatabase db = this.getReadableDatabase();
            cursor = db.rawQuery("SELECT COUNT(*) FROM " + TABLE_NAME, null);
            if (cursor != null && cursor.moveToFirst()) {
                return cursor.getInt(0);
            }
        } catch (Exception e) {
            android.util.Log.e("LocationDbHelper", "Error getting queue size", e);
        } finally {
            if (cursor != null) cursor.close();
        }
        return 0;
    }
}

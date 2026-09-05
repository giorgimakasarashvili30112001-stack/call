const { withAndroidManifest, withDangerousMod } = require('@expo/config-plugins');
const fs = require('fs');
const path = require('path');

const permissionNames = [
  'android.permission.RECORD_AUDIO',
  'android.permission.READ_PHONE_STATE',
  'android.permission.FOREGROUND_SERVICE',
  'android.permission.FOREGROUND_SERVICE_MICROPHONE',
  'android.permission.POST_NOTIFICATIONS',
];

module.exports = function withAndroidCallRecorder(config) {
  config = withAndroidManifest(config, (manifestConfig) => {
    const manifest = manifestConfig.modResults.manifest;
    const existingPermissions = manifest['uses-permission'] ?? [];
    for (const name of permissionNames) {
      if (!existingPermissions.some((item) => item?.$?.['android:name'] === name)) {
        existingPermissions.push({ $: { 'android:name': name } });
      }
    }
    manifest['uses-permission'] = existingPermissions;
    const application = manifest.application?.[0];
    if (!application) return manifestConfig;
    application.receiver = application.receiver ?? [];
    if (!application.receiver.some((item) => item?.$?.['android:name'] === '.CallStateReceiver')) {
      application.receiver.push({
        $: { 'android:name': '.CallStateReceiver', 'android:enabled': 'true', 'android:exported': 'true' },
        'intent-filter': [{ action: [{ $: { 'android:name': 'android.intent.action.PHONE_STATE' } }] }],
      });
    }
    application.service = application.service ?? [];
    if (!application.service.some((item) => item?.$?.['android:name'] === '.CallRecordingService')) {
      application.service.push({
        $: { 'android:name': '.CallRecordingService', 'android:enabled': 'true', 'android:exported': 'false', 'android:foregroundServiceType': 'microphone' },
      });
    }
    return manifestConfig;
  });

  return withDangerousMod(config, ['android', async (dangerousConfig) => {
    const packageName = dangerousConfig.android?.package ?? 'com.callrecorder.voip';
    const packagePath = packageName.replace(/\./g, '/');
    const javaDirectory = path.join(dangerousConfig.modRequest.platformProjectRoot, 'app', 'src', 'main', 'java', packagePath);
    fs.mkdirSync(javaDirectory, { recursive: true });
    fs.writeFileSync(path.join(javaDirectory, 'CallStateReceiver.java'), callStateReceiver(packageName));
    fs.writeFileSync(path.join(javaDirectory, 'CallRecordingService.java'), callRecordingService(packageName));
    return dangerousConfig;
  }]);
};

function callStateReceiver(packageName) {
  return `package ${packageName};

import android.content.BroadcastReceiver;
import android.content.Context;
import android.content.Intent;
import android.os.Build;
import android.telephony.TelephonyManager;

public class CallStateReceiver extends BroadcastReceiver {
  @Override
  public void onReceive(Context context, Intent intent) {
    if (!TelephonyManager.ACTION_PHONE_STATE_CHANGED.equals(intent.getAction())) return;
    String state = intent.getStringExtra(TelephonyManager.EXTRA_STATE);
    Intent serviceIntent = new Intent(context, CallRecordingService.class);
    if (TelephonyManager.EXTRA_STATE_OFFHOOK.equals(state)) {
      serviceIntent.setAction(CallRecordingService.ACTION_START);
    } else if (TelephonyManager.EXTRA_STATE_IDLE.equals(state)) {
      serviceIntent.setAction(CallRecordingService.ACTION_STOP);
    } else {
      return;
    }
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      context.startForegroundService(serviceIntent);
    } else {
      context.startService(serviceIntent);
    }
  }
}
`;
}

function callRecordingService(packageName) {
  return `package ${packageName};

import android.app.Notification;
import android.app.NotificationChannel;
import android.app.NotificationManager;
import android.app.Service;
import android.content.Intent;
import android.media.MediaRecorder;
import android.os.Build;
import android.os.IBinder;
import java.io.File;

public class CallRecordingService extends Service {
  public static final String ACTION_START = "${packageName}.START_RECORDING";
  public static final String ACTION_STOP = "${packageName}.STOP_RECORDING";
  private static final String CHANNEL_ID = "call-recording";
  private static final int NOTIFICATION_ID = 713;
  private MediaRecorder recorder;
  private File outputFile;

  @Override
  public int onStartCommand(Intent intent, int flags, int startId) {
    ensureChannel();
    startForeground(NOTIFICATION_ID, notification());
    if (intent != null && ACTION_STOP.equals(intent.getAction())) {
      stopRecording();
    } else if (intent != null && ACTION_START.equals(intent.getAction())) {
      startRecording();
    }
    return START_NOT_STICKY;
  }

  private void startRecording() {
    if (recorder != null) return;
    File consentFile = new File(getFilesDir(), "recording-consent.txt");
    if (!consentFile.exists()) {
      stopForeground(true);
      stopSelf();
      return;
    }
    File directory = new File(getFilesDir(), "recordings");
    if (!directory.exists()) directory.mkdirs();
    outputFile = new File(directory, "call-" + System.currentTimeMillis() + ".m4a");
    recorder = new MediaRecorder();
    try {
      recorder.setAudioSource(MediaRecorder.AudioSource.VOICE_COMMUNICATION);
      recorder.setOutputFormat(MediaRecorder.OutputFormat.MPEG_4);
      recorder.setAudioEncoder(MediaRecorder.AudioEncoder.AAC);
      recorder.setAudioEncodingBitRate(128000);
      recorder.setAudioSamplingRate(44100);
      recorder.setOutputFile(outputFile.getAbsolutePath());
      recorder.prepare();
      recorder.start();
    } catch (Exception error) {
      releaseRecorder(true);
    }
  }

  private void stopRecording() {
    if (recorder == null) {
      stopForeground(true);
      stopSelf();
      return;
    }
    try {
      recorder.stop();
    } catch (RuntimeException ignored) {
      if (outputFile != null) outputFile.delete();
    }
    releaseRecorder(false);
    stopForeground(true);
    stopSelf();
  }

  private void releaseRecorder(boolean deleteOutput) {
    if (recorder != null) {
      recorder.reset();
      recorder.release();
      recorder = null;
    }
    if (deleteOutput && outputFile != null) outputFile.delete();
    outputFile = null;
  }

  private void ensureChannel() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      NotificationChannel channel = new NotificationChannel(CHANNEL_ID, "Call recording", NotificationManager.IMPORTANCE_LOW);
      channel.setDescription("Shows when a regular phone call is being recorded.");
      getSystemService(NotificationManager.class).createNotificationChannel(channel);
    }
  }

  private Notification notification() {
    if (Build.VERSION.SDK_INT >= Build.VERSION_CODES.O) {
      return new Notification.Builder(this, CHANNEL_ID)
        .setContentTitle("Call recording active")
        .setContentText("The current phone call is being saved on this device")
        .setSmallIcon(android.R.drawable.ic_btn_speak_now)
        .setOngoing(true)
        .build();
    }
    return new Notification.Builder(this)
      .setContentTitle("Call recording active")
      .setContentText("The current phone call is being saved on this device")
      .setSmallIcon(android.R.drawable.ic_btn_speak_now)
      .setOngoing(true)
      .build();
  }

  @Override
  public void onDestroy() {
    if (recorder != null) stopRecording();
    super.onDestroy();
  }

  @Override
  public IBinder onBind(Intent intent) { return null; }
}
`;
}

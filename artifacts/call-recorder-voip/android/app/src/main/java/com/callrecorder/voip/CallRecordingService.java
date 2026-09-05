package com.callrecorder.voip;

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
  public static final String ACTION_START = "com.callrecorder.voip.START_RECORDING";
  public static final String ACTION_STOP = "com.callrecorder.voip.STOP_RECORDING";
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

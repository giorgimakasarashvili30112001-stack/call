package com.callrecorder.voip;

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

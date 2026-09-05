import AsyncStorage from '@react-native-async-storage/async-storage';
import { Feather } from '@expo/vector-icons';
import {
  RecordingPresets,
  requestRecordingPermissionsAsync,
  setAudioModeAsync,
  useAudioPlayer,
  useAudioRecorder,
} from 'expo-audio';
import * as FileSystem from 'expo-file-system/legacy';
import * as Haptics from 'expo-haptics';
import { useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  FlatList,
  Keyboard,
  Linking,
  Platform,
  Pressable,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';
import { useColors } from '@/hooks/useColors';

type CallState = 'ready' | 'connecting' | 'connected' | 'ended';
type Recording = {
  id: string;
  name: string;
  date: string;
  duration: number;
  uri: string;
  format: string;
};

const STORAGE_KEY = '@call-recorder/recordings';
const CONSENT_KEY = '@call-recorder/consent';
const CONSENT_FILE = FileSystem.documentDirectory + 'recording-consent.txt';

const formatDuration = (seconds: number) => {
  const minutes = Math.floor(seconds / 60).toString().padStart(2, '0');
  const remainder = Math.floor(seconds % 60).toString().padStart(2, '0');
  return minutes + ':' + remainder;
};

const formatDate = (date: string) => {
  const value = new Date(date);
  return value.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
};

export default function HomeScreen() {
  const colors = useColors();
  const insets = useSafeAreaInsets();
  const recorder = useAudioRecorder(RecordingPresets.HIGH_QUALITY);
  const [callState, setCallState] = useState<CallState>('ready');
  const [contact, setContact] = useState('Maya Chen');
  const [number, setNumber] = useState('+1 415 555 0138');
  const [consent, setConsent] = useState(false);
  const [showDetails, setShowDetails] = useState(false);
  const [recordings, setRecordings] = useState<Recording[]>([]);
  const [elapsed, setElapsed] = useState(0);
  const [isWorking, setIsWorking] = useState(false);
  const startedAt = useRef<number | null>(null);
  const connectTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [activeUri, setActiveUri] = useState<string | null>(null);
  const player = useAudioPlayer(activeUri ? { uri: activeUri } : undefined);

  useEffect(() => {
    let mounted = true;
    const hydrate = async () => {
      const [saved, savedConsent] = await Promise.all([AsyncStorage.getItem(STORAGE_KEY), AsyncStorage.getItem(CONSENT_KEY)]);
      if (!mounted) return;
      let localRecordings: Recording[] = [];
      if (saved) {
        try {
          localRecordings = JSON.parse(saved) as Recording[];
        } catch {
          localRecordings = [];
        }
      }
      if (Platform.OS === 'android') {
        try {
          await FileSystem.writeAsStringAsync(CONSENT_FILE, savedConsent === 'true' ? 'true' : 'false');
          const directory = FileSystem.documentDirectory + 'recordings/';
          const directoryInfo = await FileSystem.getInfoAsync(directory);
          if (directoryInfo.exists) {
            const nativeFiles = await FileSystem.readDirectoryAsync(directory);
            const nativeRecordings = nativeFiles
              .filter((file) => file.endsWith('.m4a'))
              .map((file): Recording => {
                const timestamp = file.match(/call-(\d+)\.m4a/)?.[1];
                return {
                  id: 'native-' + file,
                  name: 'Regular phone call',
                  date: new Date(timestamp ? Number(timestamp) : Date.now()).toISOString(),
                  duration: 0,
                  uri: directory + file,
                  format: 'M4A',
                };
              });
            const savedUris = new Set(localRecordings.map((item) => item.uri));
            localRecordings = [...nativeRecordings.filter((item) => !savedUris.has(item.uri)), ...localRecordings];
          }
        } catch {
          // Native recording files are optional on devices that do not expose shared app storage.
        }
      }
      setRecordings(localRecordings);
      setConsent(savedConsent === 'true');
    };
    void hydrate();
    return () => {
      mounted = false;
      if (connectTimer.current) clearTimeout(connectTimer.current);
    };
  }, []);

  useEffect(() => {
    if (callState !== 'connected' || startedAt.current === null) return;
    const interval = setInterval(() => {
      setElapsed(Math.floor((Date.now() - (startedAt.current ?? Date.now())) / 1000));
    }, 1000);
    return () => clearInterval(interval);
  }, [callState]);

  const persistRecordings = async (next: Recording[]) => {
    setRecordings(next);
    await AsyncStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  };

  const startRecording = async () => {
    await setAudioModeAsync({ allowsRecording: true, playsInSilentMode: true });
    await recorder.prepareToRecordAsync();
    recorder.record();
  };

  const startCall = async () => {
    Keyboard.dismiss();
    if (!contact.trim() || !number.trim()) {
      Alert.alert('Add a contact', 'Enter a name and number before starting a call.');
      return;
    }
    if (!consent) {
      Alert.alert('Recording consent required', 'Turn on recording consent before placing a call. Both people should know the call will be recorded.');
      return;
    }
    setIsWorking(true);
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      setIsWorking(false);
      Alert.alert('Microphone access needed', 'Allow microphone access to record an in-app call.');
      return;
    }
    await Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium);
    setCallState('connecting');
    connectTimer.current = setTimeout(async () => {
      try {
        await startRecording();
        startedAt.current = Date.now();
        setElapsed(0);
        setCallState('connected');
      } catch {
        setCallState('ready');
        Alert.alert('Could not start recording', 'The microphone could not be prepared. Please try again.');
      } finally {
        setIsWorking(false);
      }
    }, 1200);
  };

  const startRegularCall = async () => {
    Keyboard.dismiss();
    if (Platform.OS !== 'android') {
      Alert.alert('Android native build required', 'Regular-call capture is only available as a best-effort Android native feature.');
      return;
    }
    if (!number.trim()) {
      Alert.alert('Add a number', 'Enter a phone number before opening the Phone app.');
      return;
    }
    if (!consent) {
      Alert.alert('Recording consent required', 'Turn on recording consent before placing a call. Both people should know the call will be recorded.');
      return;
    }
    const permission = await requestRecordingPermissionsAsync();
    if (!permission.granted) {
      Alert.alert('Microphone access needed', 'Allow microphone access so the Android recorder can start when the call connects.');
      return;
    }
    await Linking.openURL('tel:' + number.replace(/[^\d+#*]/g, ''));
  };

  const stopCall = async () => {
    setIsWorking(true);
    try {
      const duration = startedAt.current ? Math.max(1, Math.floor((Date.now() - startedAt.current) / 1000)) : elapsed;
      if (recorder.isRecording) await recorder.stop();
      const uri = recorder.uri;
      if (uri) {
        const next: Recording = {
          id: Date.now().toString() + Math.random().toString(36).slice(2, 8),
          name: contact.trim() || 'In-app call',
          date: new Date().toISOString(),
          duration,
          uri,
          format: Platform.OS === 'web' ? 'WEBM' : 'M4A',
        };
        await persistRecordings([next, ...recordings]);
      }
      await Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success);
      setCallState('ended');
    } catch {
      Alert.alert('Could not save recording', 'The call ended, but the audio file could not be saved locally.');
      setCallState('ended');
    } finally {
      startedAt.current = null;
      setIsWorking(false);
    }
  };

  const togglePlayback = (uri: string) => {
    if (activeUri !== uri) {
      setActiveUri(uri);
      return;
    }
    player.playing ? player.pause() : player.play();
  };

  const connectionLabel = useMemo(() => {
    if (callState === 'connecting') return 'Connecting securely';
    if (callState === 'connected') return 'Recording in progress';
    if (callState === 'ended') return 'Call saved locally';
    return 'Ready for an in-app call';
  }, [callState]);

  const isLive = callState === 'connected';

  return (
    <View style={[styles.screen, { backgroundColor: colors.background, paddingTop: insets.top + 14 }]}>
      <FlatList
        data={recordings}
        keyExtractor={(item) => item.id}
        showsVerticalScrollIndicator={false}
        contentContainerStyle={{ paddingBottom: Platform.OS === 'web' ? 34 : insets.bottom + 24 }}
        ListHeaderComponent={
          <>
            <View style={styles.headerRow}>
              <View>
                <Text style={[styles.eyebrow, { color: colors.recording }]}>LOCAL CALLS</Text>
                <Text style={[styles.title, { color: colors.foreground }]}>Record room</Text>
              </View>
              <View style={[styles.statusDot, { backgroundColor: isLive ? colors.recording : colors.success }]}>
                <Feather name={isLive ? 'mic' : 'shield'} size={17} color={colors.background} />
              </View>
            </View>

            <View style={[styles.heroCard, { backgroundColor: colors.card, borderColor: colors.border }]}>
              <View style={styles.heroTopline}>
                <View style={[styles.livePill, { backgroundColor: isLive ? colors.recording : colors.accent }]}>
                  <View style={[styles.pillDot, { backgroundColor: isLive ? colors.background : colors.success }]} />
                  <Text style={[styles.pillText, { color: isLive ? colors.background : colors.accentForeground }]}>{isLive ? 'LIVE' : 'PRIVATE'}</Text>
                </View>
                <Text style={[styles.statusText, { color: colors.mutedForeground }]}>{connectionLabel}</Text>
              </View>
              <View style={styles.waveform}>
                {[18, 32, 14, 40, 24, 52, 31, 44, 20, 35, 56, 27, 43, 17, 31, 48, 24, 38, 15, 30, 42, 22, 35, 16, 29].map((height, index) => (
                  <View key={index} style={[styles.waveBar, { height: isLive ? height : height * 0.68, backgroundColor: isLive ? colors.recording : colors.mutedForeground, opacity: isLive ? 0.95 : 0.55 }]} />
                ))}
              </View>
              <View style={styles.timerRow}>
                <Text style={[styles.timer, { color: colors.foreground }]}>{formatDuration(elapsed)}</Text>
                <Text style={[styles.captureNote, { color: colors.mutedForeground }]}>{isLive ? 'Microphone audio • local file' : 'Audio stays on this phone'}</Text>
              </View>
            </View>

            {callState === 'connecting' ? (
              <View style={[styles.connectionCard, { backgroundColor: colors.secondary }]}>
                <ActivityIndicator color={colors.recording} />
                <View style={styles.connectionCopy}>
                  <Text style={[styles.connectionTitle, { color: colors.foreground }]}>Connecting to {contact}</Text>
                  <Text style={[styles.connectionSubtitle, { color: colors.mutedForeground }]}>Local recording will begin automatically when connected.</Text>
                </View>
              </View>
            ) : isLive ? (
              <Pressable testID="end-call" onPress={stopCall} disabled={isWorking} style={({ pressed }) => [styles.endButton, { backgroundColor: colors.destructive, opacity: pressed || isWorking ? 0.75 : 1 }]}>
                <Feather name="phone-off" size={20} color={colors.destructiveForeground} />
                <Text style={[styles.endButtonText, { color: colors.destructiveForeground }]}>{isWorking ? 'Saving…' : 'End & save call'}</Text>
              </Pressable>
            ) : (
              <View style={styles.formBlock}>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>CALL DETAILS</Text>
                <View style={[styles.inputShell, { backgroundColor: colors.input, borderColor: colors.border }]}>
                  <Feather name="user" size={17} color={colors.mutedForeground} />
                  <TextInput testID="contact-name" value={contact} onChangeText={setContact} placeholder="Contact name" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} />
                </View>
                <View style={[styles.inputShell, { backgroundColor: colors.input, borderColor: colors.border }]}>
                  <Feather name="phone" size={17} color={colors.mutedForeground} />
                  <TextInput testID="contact-number" value={number} onChangeText={setNumber} keyboardType="phone-pad" placeholder="Phone number" placeholderTextColor={colors.mutedForeground} style={[styles.input, { color: colors.foreground }]} />
                </View>
                <View style={[styles.consentRow, { borderColor: colors.border }]}>
                  <View style={[styles.consentIcon, { backgroundColor: colors.accent }]}><Feather name="volume-2" size={16} color={colors.accentForeground} /></View>
                  <View style={styles.consentCopy}>
                    <Text style={[styles.consentTitle, { color: colors.foreground }]}>Recording consent</Text>
                    <Text style={[styles.consentSubtitle, { color: colors.mutedForeground }]}>I’ll tell the other person this call is being recorded.</Text>
                  </View>
                  <Switch testID="consent-toggle" value={consent} onValueChange={(value) => { setConsent(value); void AsyncStorage.setItem(CONSENT_KEY, String(value)); if (Platform.OS === 'android') void FileSystem.writeAsStringAsync(CONSENT_FILE, String(value)); }} trackColor={{ false: colors.muted, true: colors.recording }} thumbColor={colors.foreground} />
                </View>
                <Pressable testID="start-call" onPress={startCall} disabled={isWorking} style={({ pressed }) => [styles.startButton, { backgroundColor: colors.primary, opacity: pressed || isWorking ? 0.8 : 1 }]}>
                  <Feather name="phone" size={20} color={colors.primaryForeground} />
                  <Text style={[styles.startButtonText, { color: colors.primaryForeground }]}>{isWorking ? 'Preparing…' : callState === 'ended' ? 'Start another call' : 'Start in-app call'}</Text>
                  <Feather name="arrow-up-right" size={18} color={colors.primaryForeground} />
                </Pressable>
                {Platform.OS === 'android' && (
                  <Pressable testID="regular-call" onPress={startRegularCall} style={({ pressed }) => [styles.regularButton, { borderColor: colors.border, backgroundColor: colors.secondary, opacity: pressed ? 0.75 : 1 }]}>
                    <View style={[styles.regularIcon, { backgroundColor: colors.accent }]}>
                      <Feather name="phone-call" size={17} color={colors.accentForeground} />
                    </View>
                    <View style={styles.regularCopy}>
                      <Text style={[styles.regularTitle, { color: colors.foreground }]}>Use the Phone app</Text>
                      <Text style={[styles.regularSubtitle, { color: colors.mutedForeground }]}>Android recorder listens for call state</Text>
                    </View>
                    <Feather name="chevron-right" size={17} color={colors.mutedForeground} />
                  </Pressable>
                )}
              </View>
            )}

            <Pressable testID="details-toggle" onPress={() => setShowDetails(!showDetails)} style={styles.detailsToggle}>
              <Feather name={showDetails ? 'chevron-up' : 'info'} size={16} color={colors.recording} />
              <Text style={[styles.detailsText, { color: colors.recording }]}>{showDetails ? 'Hide recording notes' : 'How this works'}</Text>
            </Pressable>
            {showDetails && (
              <View style={[styles.infoCard, { backgroundColor: colors.secondary, borderColor: colors.border }]}>
                <Text style={[styles.infoTitle, { color: colors.foreground }]}>Android native call capture</Text>
                <Text style={[styles.infoBody, { color: colors.mutedForeground }]}>On a native Android build, the Phone app shortcut can hand off to your regular dialer while the recorder listens for answered and ended call states. Device and carrier support varies: some phones block the remote side, some block call audio entirely, and recordings are saved as M4A rather than guaranteed MP3.</Text>
              </View>
            )}

            <View style={styles.libraryHeader}>
              <View>
                <Text style={[styles.sectionLabel, { color: colors.mutedForeground }]}>ON THIS PHONE</Text>
                <Text style={[styles.libraryTitle, { color: colors.foreground }]}>Recent recordings</Text>
              </View>
              <Text style={[styles.count, { color: colors.mutedForeground }]}>{recordings.length.toString().padStart(2, '0')}</Text>
            </View>
          </>
        }
        renderItem={({ item }) => (
          <View style={[styles.recordingRow, { backgroundColor: colors.card, borderColor: colors.border }]}>
            <Pressable testID={'play-' + item.id} onPress={() => togglePlayback(item.uri)} style={({ pressed }) => [styles.playButton, { backgroundColor: activeUri === item.uri && player.playing ? colors.primary : colors.accent, opacity: pressed ? 0.7 : 1 }]}>
              <Feather name={activeUri === item.uri && player.playing ? 'pause' : 'play'} size={16} color={activeUri === item.uri && player.playing ? colors.primaryForeground : colors.accentForeground} />
            </Pressable>
            <View style={styles.recordingCopy}>
              <Text numberOfLines={1} style={[styles.recordingName, { color: colors.foreground }]}>{item.name}</Text>
              <Text style={[styles.recordingMeta, { color: colors.mutedForeground }]}>{formatDate(item.date)}  •  {item.format}  •  Local</Text>
            </View>
            <Text style={[styles.recordingDuration, { color: colors.mutedForeground }]}>{formatDuration(item.duration)}</Text>
          </View>
        )}
        ListEmptyComponent={<View style={[styles.emptyCard, { borderColor: colors.border }]}><Feather name="mic" size={22} color={colors.mutedForeground} /><Text style={[styles.emptyTitle, { color: colors.foreground }]}>No recordings yet</Text><Text style={[styles.emptyBody, { color: colors.mutedForeground }]}>Your saved calls will appear here and stay on this device.</Text></View>}
      />
    </View>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1 },
  headerRow: { paddingHorizontal: 22, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginBottom: 22 },
  eyebrow: { fontSize: 11, fontWeight: '700', letterSpacing: 2.2, marginBottom: 6 },
  title: { fontSize: 32, fontWeight: '700', letterSpacing: -1.1 },
  statusDot: { width: 42, height: 42, borderRadius: 21, alignItems: 'center', justifyContent: 'center' },
  heroCard: { marginHorizontal: 18, padding: 20, borderWidth: 1, borderRadius: 26, marginBottom: 15 },
  heroTopline: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  livePill: { paddingHorizontal: 10, paddingVertical: 6, borderRadius: 20, flexDirection: 'row', alignItems: 'center', gap: 6 },
  pillDot: { width: 6, height: 6, borderRadius: 3 },
  pillText: { fontSize: 10, fontWeight: '700', letterSpacing: 1.3 },
  statusText: { fontSize: 12, fontWeight: '500' },
  waveform: { height: 78, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', marginVertical: 20, paddingHorizontal: 3 },
  waveBar: { width: 5, borderRadius: 4 },
  timerRow: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between' },
  timer: { fontSize: 36, fontWeight: '600', letterSpacing: -1.5, fontVariant: ['tabular-nums'] },
  captureNote: { fontSize: 12 },
  connectionCard: { marginHorizontal: 18, padding: 16, borderRadius: 18, flexDirection: 'row', alignItems: 'center', gap: 13, marginBottom: 22 },
  connectionCopy: { flex: 1 },
  connectionTitle: { fontSize: 14, fontWeight: '600', marginBottom: 4 },
  connectionSubtitle: { fontSize: 12, lineHeight: 17 },
  formBlock: { paddingHorizontal: 22 },
  sectionLabel: { fontSize: 10, fontWeight: '700', letterSpacing: 1.7, marginBottom: 10 },
  inputShell: { height: 53, borderWidth: 1, borderRadius: 16, paddingHorizontal: 15, flexDirection: 'row', alignItems: 'center', gap: 11, marginBottom: 10 },
  input: { flex: 1, fontSize: 15, fontWeight: '500' },
  consentRow: { minHeight: 74, borderTopWidth: 1, borderBottomWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 11, paddingVertical: 11, marginTop: 8, marginBottom: 15 },
  consentIcon: { width: 35, height: 35, borderRadius: 12, alignItems: 'center', justifyContent: 'center' },
  consentCopy: { flex: 1 },
  consentTitle: { fontSize: 13, fontWeight: '600', marginBottom: 3 },
  consentSubtitle: { fontSize: 11, lineHeight: 15 },
  startButton: { height: 57, borderRadius: 18, paddingHorizontal: 18, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  startButtonText: { fontSize: 15, fontWeight: '700', flex: 1, marginLeft: 12 },
  regularButton: { minHeight: 64, borderRadius: 18, paddingHorizontal: 12, flexDirection: 'row', alignItems: 'center', gap: 11, marginTop: 10, borderWidth: 1 },
  regularIcon: { width: 38, height: 38, borderRadius: 13, alignItems: 'center', justifyContent: 'center' },
  regularCopy: { flex: 1 },
  regularTitle: { fontSize: 13, fontWeight: '700', marginBottom: 3 },
  regularSubtitle: { fontSize: 11 },
  endButton: { marginHorizontal: 22, height: 56, borderRadius: 18, paddingHorizontal: 19, flexDirection: 'row', gap: 10, alignItems: 'center', justifyContent: 'center' },
  endButtonText: { fontSize: 15, fontWeight: '700' },
  detailsToggle: { marginHorizontal: 22, marginTop: 19, flexDirection: 'row', alignItems: 'center', gap: 7, paddingVertical: 4 },
  detailsText: { fontSize: 12, fontWeight: '600' },
  infoCard: { marginHorizontal: 22, marginTop: 11, padding: 15, borderRadius: 16, borderWidth: 1 },
  infoTitle: { fontSize: 13, fontWeight: '700', marginBottom: 6 },
  infoBody: { fontSize: 12, lineHeight: 18 },
  libraryHeader: { paddingHorizontal: 22, marginTop: 29, marginBottom: 11, flexDirection: 'row', justifyContent: 'space-between', alignItems: 'flex-end' },
  libraryTitle: { fontSize: 22, fontWeight: '700', letterSpacing: -0.5 },
  count: { fontSize: 12, fontWeight: '600', marginBottom: 3 },
  recordingRow: { marginHorizontal: 18, padding: 12, borderRadius: 17, borderWidth: 1, flexDirection: 'row', alignItems: 'center', gap: 12, marginBottom: 8 },
  playButton: { width: 40, height: 40, borderRadius: 14, alignItems: 'center', justifyContent: 'center' },
  recordingCopy: { flex: 1 },
  recordingName: { fontSize: 14, fontWeight: '600', marginBottom: 5 },
  recordingMeta: { fontSize: 11 },
  recordingDuration: { fontSize: 12, fontWeight: '600', fontVariant: ['tabular-nums'] },
  emptyCard: { marginHorizontal: 18, padding: 22, minHeight: 118, borderRadius: 17, borderWidth: 1, borderStyle: 'dashed', alignItems: 'center', justifyContent: 'center' },
  emptyTitle: { fontSize: 14, fontWeight: '600', marginTop: 8, marginBottom: 4 },
  emptyBody: { fontSize: 12, textAlign: 'center', lineHeight: 17, maxWidth: 250 },
});

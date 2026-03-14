use cpal::traits::{DeviceTrait, HostTrait, StreamTrait};
use cpal::{Device, SampleFormat, StreamConfig};
use hound::{WavSpec, WavWriter};
use serde::{Deserialize, Serialize};
use std::sync::mpsc::{self, Sender};
use std::sync::{Arc, Mutex};
use std::thread::{self, JoinHandle};
use tauri::{AppHandle, Emitter, State};

use crate::AppState;

/// Audio device info for the frontend
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct AudioDeviceInfo {
    pub name: String,
    pub is_default: bool,
}

enum RecordingCommand {
    Stop,
}

pub(crate) struct RecordingHandle {
    stop_sender: Sender<RecordingCommand>,
    thread_handle: JoinHandle<Result<(), String>>,
}

/// Get available audio input devices
#[tauri::command]
pub fn get_audio_devices() -> Result<Vec<AudioDeviceInfo>, String> {
    let host = cpal::default_host();
    let default_device = host.default_input_device();
    let default_name = default_device.as_ref().and_then(|d| d.name().ok());

    let devices: Vec<AudioDeviceInfo> = host
        .input_devices()
        .map_err(|e| format!("Failed to get input devices: {}", e))?
        .filter_map(|device| {
            device.name().ok().map(|name| AudioDeviceInfo {
                is_default: Some(&name) == default_name.as_ref(),
                name,
            })
        })
        .collect();

    Ok(devices)
}

fn get_default_input_device() -> Result<Device, String> {
    let host = cpal::default_host();
    host.default_input_device()
        .ok_or_else(|| "No default input device available".to_string())
}

/// Start audio recording
#[tauri::command]
pub fn start_recording(state: State<AppState>, app_handle: AppHandle) -> Result<String, String> {
    // TOCTOU fix: hold the lock across check-and-set so two concurrent calls
    // cannot both pass the "already recording" check.
    {
        let mut handle_guard = state
            .recording_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        if handle_guard.is_some() {
            return Err("Already recording".to_string());
        }

        // Create output file path
        let temp_dir = std::env::temp_dir();
        let output_path = temp_dir.join("whisper_translate_recording.wav");
        let output_path_str = output_path.to_string_lossy().to_string();
        let output_path_clone = output_path.clone();

        // Create channel for stop signal
        let (stop_tx, stop_rx) = mpsc::channel::<RecordingCommand>();

        // Clone app handle for the recording thread
        let app_handle_clone = app_handle.clone();

        // Spawn recording thread
        let thread_handle = thread::spawn(move || -> Result<(), String> {
            let device = get_default_input_device()?;
            let supported_config = device
                .default_input_config()
                .map_err(|e| format!("Failed to get default input config: {}", e))?;

            let sample_format = supported_config.sample_format();
            let config: StreamConfig = supported_config.into();

            log::info!(
                "Recording with device config: channels={}, sample_rate={}, format={:?}",
                config.channels,
                config.sample_rate.0,
                sample_format
            );

            // Calculate RMS threshold: emit every sample_rate/30 samples (~33ms for 30fps)
            let rms_interval = (config.sample_rate.0 / 30) as usize;

            // Create WAV writer with the device's native config
            let spec = WavSpec {
                channels: 1, // We'll convert to mono
                sample_rate: config.sample_rate.0,
                bits_per_sample: 16,
                sample_format: hound::SampleFormat::Int,
            };

            let writer = WavWriter::create(&output_path_clone, spec)
                .map_err(|e| format!("Failed to create WAV file: {}", e))?;

            let writer = Arc::new(Mutex::new(Some(writer)));
            let writer_for_callback = writer.clone();
            let channels = config.channels as usize;
            let sample_count = Arc::new(Mutex::new(0usize));
            let sample_count_for_callback = sample_count.clone();

            // RMS accumulation state
            let rms_sum = Arc::new(Mutex::new(0.0f64));
            let rms_count = Arc::new(Mutex::new(0usize));

            let err_fn = |err| log::error!("Audio stream error: {}", err);

            let stream = match sample_format {
                SampleFormat::F32 => {
                    let writer = writer_for_callback.clone();
                    let sc = sample_count_for_callback.clone();
                    let rms_s = rms_sum.clone();
                    let rms_c = rms_count.clone();
                    let ah = app_handle_clone.clone();
                    device.build_input_stream(
                        &config,
                        move |data: &[f32], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut guard) = writer.lock() {
                                if let Some(ref mut w) = *guard {
                                    for chunk in data.chunks(channels) {
                                        let sum: f32 = chunk.iter().sum();
                                        let mono_sample = sum / channels as f32;
                                        let sample_i16 =
                                            (mono_sample * 32767.0).clamp(-32768.0, 32767.0) as i16;
                                        let _ = w.write_sample(sample_i16);

                                        // Accumulate for RMS
                                        if let Ok(mut rs) = rms_s.lock() {
                                            if let Ok(mut rc) = rms_c.lock() {
                                                *rs += (mono_sample as f64) * (mono_sample as f64);
                                                *rc += 1;

                                                if *rc >= rms_interval {
                                                    let rms = (*rs / *rc as f64).sqrt() as f32;
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = ah.emit("audio-level", level);
                                                    *rs = 0.0;
                                                    *rc = 0;
                                                }
                                            }
                                        }
                                    }
                                    if let Ok(mut count) = sc.lock() {
                                        *count += data.len() / channels;
                                    }
                                }
                            }
                        },
                        err_fn,
                        None,
                    )
                }
                SampleFormat::I16 => {
                    let writer = writer_for_callback.clone();
                    let rms_s = rms_sum.clone();
                    let rms_c = rms_count.clone();
                    let ah = app_handle_clone.clone();
                    device.build_input_stream(
                        &config,
                        move |data: &[i16], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut guard) = writer.lock() {
                                if let Some(ref mut w) = *guard {
                                    for chunk in data.chunks(channels) {
                                        let sum: i32 = chunk.iter().map(|&s| s as i32).sum();
                                        let mono_sample = (sum / channels as i32) as i16;
                                        let _ = w.write_sample(mono_sample);

                                        // Accumulate for RMS (normalize to -1.0..1.0)
                                        let normalized = mono_sample as f64 / 32768.0;
                                        if let Ok(mut rs) = rms_s.lock() {
                                            if let Ok(mut rc) = rms_c.lock() {
                                                *rs += normalized * normalized;
                                                *rc += 1;

                                                if *rc >= rms_interval {
                                                    let rms = (*rs / *rc as f64).sqrt() as f32;
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = ah.emit("audio-level", level);
                                                    *rs = 0.0;
                                                    *rc = 0;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        err_fn,
                        None,
                    )
                }
                SampleFormat::U16 => {
                    let writer = writer_for_callback.clone();
                    let rms_s = rms_sum.clone();
                    let rms_c = rms_count.clone();
                    let ah = app_handle_clone.clone();
                    device.build_input_stream(
                        &config,
                        move |data: &[u16], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut guard) = writer.lock() {
                                if let Some(ref mut w) = *guard {
                                    for chunk in data.chunks(channels) {
                                        let sum: i32 =
                                            chunk.iter().map(|&s| s as i32 - 32768).sum();
                                        let mono_sample = (sum / channels as i32) as i16;
                                        let _ = w.write_sample(mono_sample);

                                        // Accumulate for RMS (normalize to -1.0..1.0)
                                        let normalized = mono_sample as f64 / 32768.0;
                                        if let Ok(mut rs) = rms_s.lock() {
                                            if let Ok(mut rc) = rms_c.lock() {
                                                *rs += normalized * normalized;
                                                *rc += 1;

                                                if *rc >= rms_interval {
                                                    let rms = (*rs / *rc as f64).sqrt() as f32;
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = ah.emit("audio-level", level);
                                                    *rs = 0.0;
                                                    *rc = 0;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        err_fn,
                        None,
                    )
                }
                SampleFormat::I32 => {
                    let writer = writer_for_callback.clone();
                    let rms_s = rms_sum.clone();
                    let rms_c = rms_count.clone();
                    let ah = app_handle_clone.clone();
                    device.build_input_stream(
                        &config,
                        move |data: &[i32], _: &cpal::InputCallbackInfo| {
                            if let Ok(mut guard) = writer.lock() {
                                if let Some(ref mut w) = *guard {
                                    for chunk in data.chunks(channels) {
                                        let sum: i64 =
                                            chunk.iter().map(|&s| s as i64).sum();
                                        let mono_sample = (sum / channels as i64) as i32;
                                        let sample_i16 = (mono_sample >> 16) as i16;
                                        let _ = w.write_sample(sample_i16);

                                        // Accumulate for RMS (normalize to -1.0..1.0)
                                        let normalized = mono_sample as f64 / 2147483648.0;
                                        if let Ok(mut rs) = rms_s.lock() {
                                            if let Ok(mut rc) = rms_c.lock() {
                                                *rs += normalized * normalized;
                                                *rc += 1;

                                                if *rc >= rms_interval {
                                                    let rms = (*rs / *rc as f64).sqrt() as f32;
                                                    let level = (rms * 5.0).clamp(0.0, 1.0);
                                                    let _ = ah.emit("audio-level", level);
                                                    *rs = 0.0;
                                                    *rc = 0;
                                                }
                                            }
                                        }
                                    }
                                }
                            }
                        },
                        err_fn,
                        None,
                    )
                }
                _ => return Err(format!("Unsupported sample format: {:?}", sample_format)),
            }
            .map_err(|e| format!("Failed to build input stream: {}", e))?;

            stream
                .play()
                .map_err(|e| format!("Failed to start stream: {}", e))?;

            log::info!("Recording started on audio thread");

            // Wait for stop signal
            let _ = stop_rx.recv();

            // Stop stream
            drop(stream);

            // Log sample count
            if let Ok(count) = sample_count.lock() {
                log::info!("Total samples recorded: {}", *count);
            }

            // Finalize the WAV file
            if let Ok(mut guard) = writer.lock() {
                if let Some(w) = guard.take() {
                    w.finalize()
                        .map_err(|e| format!("Failed to finalize WAV file: {}", e))?;
                }
            }

            log::info!("Recording stopped on audio thread");
            Ok(())
        });

        // Store the handle atomically (check-and-set was done above while holding the lock)
        *handle_guard = Some(RecordingHandle {
            stop_sender: stop_tx,
            thread_handle,
        });

        // Emit recording state change
        let _ = app_handle.emit("recording-state-change", "recording");

        log::info!("Recording started, output: {}", output_path_str);
        Ok(output_path_str)
    }
}

/// Stop audio recording and return the path to the recorded file
#[tauri::command]
pub fn stop_recording(state: State<AppState>, app_handle: AppHandle) -> Result<String, String> {
    // Take the handle atomically — if None, we were not recording.
    let handle = {
        let mut handle_guard = state
            .recording_handle
            .lock()
            .unwrap_or_else(|e| e.into_inner());
        handle_guard.take()
    };

    let Some(handle) = handle else {
        return Err("Not currently recording".to_string());
    };

    // Send stop signal
    let _ = handle.stop_sender.send(RecordingCommand::Stop);

    // Wait for thread to finish
    if let Err(e) = handle.thread_handle.join() {
        log::error!("Recording thread panicked: {:?}", e);
    }

    // Emit recording state change
    let _ = app_handle.emit("recording-state-change", "idle");

    let temp_dir = std::env::temp_dir();
    let output_path = temp_dir
        .join("whisper_translate_recording.wav")
        .to_string_lossy()
        .to_string();

    // Debug: check file size
    if let Ok(metadata) = std::fs::metadata(&output_path) {
        log::info!(
            "Recording stopped, file: {}, size: {} bytes",
            output_path,
            metadata.len()
        );
    } else {
        log::warn!(
            "Recording stopped, file: {} (couldn't get size)",
            output_path
        );
    }

    Ok(output_path)
}

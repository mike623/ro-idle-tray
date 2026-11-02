//! wry's WKUIDelegate has no alert/confirm/prompt handlers, so WebKit answers
//! them instantly (prompt → null, confirm → false). Add the three handlers to
//! wry's delegate class at runtime and show them as native NSAlerts.
use block2::Block;
use objc2::ffi::class_addMethod;
use objc2::rc::Retained;
use objc2::runtime::{AnyClass, AnyObject, Bool, Imp, Sel};
use objc2::{class, msg_send, sel};
use objc2_foundation::{NSPoint, NSRect, NSSize, NSString};
use std::ffi::c_void;

/// Runs a modal alert; returns whether OK was pressed and the field text (prompt only).
// ponytail: app-modal runModal, not a per-window sheet; fine for one-off game dialogs.
unsafe fn run(msg: &NSString, cancel: bool, field_text: Option<&NSString>) -> (bool, Option<Retained<NSString>>) {
    unsafe {
        let alert: Retained<AnyObject> = msg_send![class!(NSAlert), new];
        let _: () = msg_send![&alert, setMessageText: &*NSString::from_str("ro-idle.app")];
        let _: () = msg_send![&alert, setInformativeText: msg];
        let _: *mut AnyObject = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("OK")];
        if cancel {
            let _: *mut AnyObject = msg_send![&alert, addButtonWithTitle: &*NSString::from_str("Cancel")];
        }
        let field = field_text.map(|t| {
            let f: Retained<AnyObject> = msg_send![class!(NSTextField), textFieldWithString: t];
            let _: () = msg_send![&f, setFrame: NSRect::new(NSPoint::new(0.0, 0.0), NSSize::new(320.0, 24.0))];
            let _: () = msg_send![&alert, setAccessoryView: &*f];
            let _: () = msg_send![&alert, layout];
            let win: *mut AnyObject = msg_send![&alert, window];
            let _: () = msg_send![win, setInitialFirstResponder: &*f];
            f
        });
        let app: *mut AnyObject = msg_send![class!(NSApplication), sharedApplication];
        let _: () = msg_send![app, activateIgnoringOtherApps: true];
        let resp: isize = msg_send![&alert, runModal];
        let ok = resp == 1000; // NSAlertFirstButtonReturn
        let text = field.filter(|_| ok).map(|f| msg_send![&f, stringValue]);
        (ok, text)
    }
}

unsafe extern "C-unwind" fn alert_imp(_: *mut AnyObject, _: Sel, _: *mut AnyObject, msg: *mut NSString, _: *mut AnyObject, done: &Block<dyn Fn()>) {
    unsafe { run(&*msg, false, None) };
    done.call(());
}

unsafe extern "C-unwind" fn confirm_imp(_: *mut AnyObject, _: Sel, _: *mut AnyObject, msg: *mut NSString, _: *mut AnyObject, done: &Block<dyn Fn(Bool)>) {
    let (ok, _) = unsafe { run(&*msg, true, None) };
    done.call((Bool::new(ok),));
}

unsafe extern "C-unwind" fn prompt_imp(_: *mut AnyObject, _: Sel, _: *mut AnyObject, msg: *mut NSString, def: *mut NSString, _: *mut AnyObject, done: &Block<dyn Fn(*mut NSString)>) {
    let empty = NSString::new();
    let (_, text) = unsafe { run(&*msg, true, Some(def.as_ref().unwrap_or(&empty))) };
    done.call((text.as_ref().map_or(std::ptr::null_mut(), |t| Retained::as_ptr(t) as *mut NSString),));
}

/// `webview` is the WKWebView from `with_webview(|w| w.inner())`. Main thread only.
pub fn install(webview: *mut c_void) {
    unsafe {
        let wv = webview as *mut AnyObject;
        let delegate: *mut AnyObject = msg_send![wv, UIDelegate];
        let Some(d) = delegate.as_ref() else { return };
        let cls = d.class() as *const AnyClass as *mut AnyClass;
        // Returns NO when already added (class is shared by every window); harmless.
        class_addMethod(cls, sel!(webView:runJavaScriptAlertPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<unsafe extern "C-unwind" fn(_, _, _, _, _, _), Imp>(alert_imp), c"v@:@@@@?".as_ptr());
        class_addMethod(cls, sel!(webView:runJavaScriptConfirmPanelWithMessage:initiatedByFrame:completionHandler:),
            std::mem::transmute::<unsafe extern "C-unwind" fn(_, _, _, _, _, _), Imp>(confirm_imp), c"v@:@@@@?".as_ptr());
        class_addMethod(cls, sel!(webView:runJavaScriptTextInputPanelWithPrompt:defaultText:initiatedByFrame:completionHandler:),
            std::mem::transmute::<unsafe extern "C-unwind" fn(_, _, _, _, _, _, _), Imp>(prompt_imp), c"v@:@@@@@?".as_ptr());
        // WebKit caches which delegate methods exist when the delegate is set; re-set it.
        let _: () = msg_send![wv, setUIDelegate: std::ptr::null_mut::<AnyObject>()];
        let _: () = msg_send![wv, setUIDelegate: delegate];
    }
}
